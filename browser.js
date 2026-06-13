/**
 * browser.js — Chrome lifecycle + CDP session management
 *
 * Two modes, selected by BROWSER_INSPECTOR_MODE:
 *   - "attached" — connect to an existing Chrome on --remote-debugging-port
 *                  so the tool inspects the tab the user is actually looking at.
 *   - "managed"  — launch a puppeteer-controlled headless Chrome.
 *   - "auto"     — try attached first, fall back to managed if the debug port
 *                  is unreachable. Default. Additionally, if an earlier call
 *                  ended up in managed (port was down then) and a later call
 *                  finds the port is now up, the managed browser is torn down
 *                  and the tool self-heals into attached mode.
 *
 * In attached mode we NEVER call browser.close() (that would kill the user's
 * real Chrome) and we NEVER call page.setViewport() (that would resize the
 * user's real window). Managed mode is unchanged from v2.2.0.
 */

import puppeteer from "puppeteer";
import net from "node:net";
import http from "node:http";
import { chromeDebugPortErrorMessage } from "./tools/error-guidance.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const VALID_MODES = new Set(["auto", "attached", "managed"]);

function readConfig() {
  const rawMode = (process.env.BROWSER_INSPECTOR_MODE || "auto").toLowerCase();
  const mode = VALID_MODES.has(rawMode) ? rawMode : "auto";
  const host = process.env.BROWSER_INSPECTOR_HOST || "127.0.0.1";
  const port = Number.parseInt(process.env.BROWSER_INSPECTOR_PORT || "9222", 10);
  return { mode, host, port: Number.isFinite(port) && port > 0 ? port : 9222 };
}

// ─── Module state ────────────────────────────────────────────────────────────

let browser = null;
let currentMode = null; // "attached" | "managed" | null
let managedPage = null; // only used in managed mode
let managedViewport = { width: 1440, height: 900 };
const cdpSessions = new WeakMap(); // page -> CDPSession

// ─── Port probing ────────────────────────────────────────────────────────────

function probePortOpen(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

function fetchJson(host, port, path, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path, timeout: timeoutMs }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", reject);
  });
}

// ─── URL matching ────────────────────────────────────────────────────────────

function normalizeUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    let pathname = u.pathname || "/";
    if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    return {
      origin: u.origin.toLowerCase(),
      pathname,
    };
  } catch {
    return null;
  }
}

function isNonUserTab(urlStr) {
  if (!urlStr) return true;
  return (
    urlStr.startsWith("chrome://") ||
    urlStr.startsWith("chrome-extension://") ||
    urlStr.startsWith("devtools://") ||
    urlStr.startsWith("edge://") ||
    urlStr === "about:blank"
  );
}

/**
 * Rank a candidate tab against the target URL.
 *   3 = exact (origin + same normalized pathname)
 *   2 = origin-only match (target had no meaningful pathname)
 *   0 = no match
 */
function rankUrlMatch(target, tab) {
  if (!target || !tab) return 0;
  if (target.origin !== tab.origin) return 0;
  if (target.pathname === tab.pathname) return 3;
  if (target.pathname === "" || target.pathname === "/") return 2;
  return 0;
}

// ─── Browser lifecycle ───────────────────────────────────────────────────────

async function connectAttached(host, port) {
  // First confirm the port is speaking CDP by hitting /json/version.
  // puppeteer.connect({ browserURL }) also does this but surfaces less useful errors.
  const version = await fetchJson(host, port, "/json/version");
  if (!version.webSocketDebuggerUrl) {
    throw new Error(`Port ${port} responded but does not expose webSocketDebuggerUrl.`);
  }
  const browserInstance = await puppeteer.connect({
    browserWSEndpoint: version.webSocketDebuggerUrl,
    defaultViewport: null, // respect the user's real window size
  });
  return browserInstance;
}

async function launchManaged() {
  return puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--ignore-certificate-errors",
    ],
  });
}

async function ensureBrowser() {
  const { mode, host, port } = readConfig();

  // If we already have a live connection, keep it — with one exception.
  // In auto mode, an earlier call may have settled on managed because the
  // debug port was down at that moment. If the user has since launched their
  // own Chrome with --remote-debugging-port, we should upgrade to attached
  // rather than silently keep inspecting a headless browser the user can't
  // see. Probe the port on each call; if it's now up, tear down managed and
  // fall through to the attach path below.
  if (browser && browser.isConnected()) {
    if (mode === "auto" && currentMode === "managed") {
      const portOpen = await probePortOpen(host, port);
      if (portOpen) {
        try { await browser.close(); } catch { /* best-effort */ }
        browser = null;
        currentMode = null;
        managedPage = null;
      } else {
        return { browser, mode: currentMode };
      }
    } else {
      return { browser, mode: currentMode };
    }
  }

  // Reset stale state (no-op if we just tore down above)
  browser = null;
  currentMode = null;
  managedPage = null;

  let attachedError = null;
  if (mode === "attached" || mode === "auto") {
    const portOpen = await probePortOpen(host, port);
    if (portOpen) {
      try {
        browser = await connectAttached(host, port);
        currentMode = "attached";
        return { browser, mode: currentMode };
      } catch (err) {
        attachedError = err;
      }
    } else {
      attachedError = new Error(`Port ${port} not reachable on ${host}`);
    }
    if (mode === "attached") {
      throw new Error(chromeDebugPortErrorMessage({ host, port }));
    }
  }

  // managed, or auto-fallback
  try {
    browser = await launchManaged();
    currentMode = "managed";
    managedPage = await browser.newPage();
    await managedPage.setViewport(managedViewport);
    return { browser, mode: currentMode };
  } catch (err) {
    browser = null;
    currentMode = null;
    if (mode === "auto") {
      throw new Error(
        chromeDebugPortErrorMessage({ host, port, managedError: err.message })
      );
    }
    throw new Error(`Chrome failed to launch: ${err.message}`);
  }
}

// ─── Page resolution ─────────────────────────────────────────────────────────

async function listUserPages(browserInstance) {
  // Iterate all browser contexts so incognito tabs are included
  const pages = [];
  for (const ctx of browserInstance.browserContexts()) {
    const ctxPages = await ctx.pages();
    for (const page of ctxPages) {
      if (page.isClosed()) continue;
      const tabUrl = page.url();
      if (isNonUserTab(tabUrl)) continue;
      pages.push(page);
    }
  }
  return pages;
}

/**
 * Resolve the page to operate on.
 *   - Managed mode: single persistent page; navigate if URL differs; apply viewport.
 *   - Attached mode: URL-match across open tabs; fall back to active tab.
 *     Optionally open a new tab with openInNewTab.
 */
export async function resolvePage({ url, openInNewTab = false, viewport } = {}) {
  const { browser: browserInstance, mode } = await ensureBrowser();

  if (mode === "managed") {
    if (!managedPage || managedPage.isClosed()) {
      managedPage = await browserInstance.newPage();
      await managedPage.setViewport(managedViewport);
    }
    if (viewport && (viewport.width !== managedViewport.width || viewport.height !== managedViewport.height)) {
      managedViewport = { width: viewport.width, height: viewport.height };
      await managedPage.setViewport(managedViewport);
    }
    if (url) {
      const current = managedPage.url();
      if (current === "about:blank" || current !== url) {
        await managedPage.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      }
    }
    return { page: managedPage, mode };
  }

  // Attached mode
  if (openInNewTab) {
    if (!url) {
      throw new Error(`openInNewTab requires a url.`);
    }
    const page = await browserInstance.newPage();
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    const warning = viewport
      ? `viewport ignored in attached mode — the tool does not resize the user's real Chrome window.`
      : null;
    return { page, mode, warning };
  }

  const userPages = await listUserPages(browserInstance);
  if (userPages.length === 0) {
    throw new Error(
      `Connected to Chrome on the debug port, but no user tabs are open (only internal pages like chrome:// or extensions). Open a tab to the page you want to inspect.`
    );
  }

  let chosenPage = null;
  let matchWarning = null;

  if (url) {
    const target = normalizeUrl(url);
    if (target) {
      let bestRank = 0;
      for (const page of userPages) {
        const tab = normalizeUrl(page.url());
        const rank = rankUrlMatch(target, tab);
        if (rank > bestRank) {
          bestRank = rank;
          chosenPage = page;
        }
      }
    }
    if (!chosenPage) {
      chosenPage = userPages[0];
      matchWarning =
        `URL "${url}" did not match any open tab. Inspecting the first user tab instead (${chosenPage.url()}). ` +
        `Navigate your Chrome to the target URL, or call again with openInNewTab: true to open a fresh tab.`;
    }
  } else {
    chosenPage = userPages[0];
  }

  const warningParts = [];
  if (matchWarning) warningParts.push(matchWarning);
  if (viewport) {
    warningParts.push(
      `viewport ignored in attached mode — the tool does not resize the user's real Chrome window.`
    );
  }

  return {
    page: chosenPage,
    mode,
    warning: warningParts.length ? warningParts.join(" ") : null,
  };
}

// ─── CDP session management ──────────────────────────────────────────────────

export async function getCDPSession(page) {
  if (!page) throw new Error("getCDPSession: page is required");
  if (page.isClosed()) {
    throw new Error("The target tab was closed. Re-run the tool to re-select a tab.");
  }
  let session = cdpSessions.get(page);
  if (!session) {
    session = await page.createCDPSession();
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    cdpSessions.set(page, session);
  }
  return session;
}

// ─── Public accessors ────────────────────────────────────────────────────────

export function getMode() {
  return currentMode;
}

export async function closeBrowser() {
  if (!browser) return;
  try {
    if (currentMode === "attached") {
      await browser.disconnect();
    } else {
      await browser.close();
    }
  } catch {
    // best-effort cleanup
  }
  browser = null;
  currentMode = null;
  managedPage = null;
}

// ─── Backwards-compat shim ───────────────────────────────────────────────────

/**
 * @deprecated Use resolvePage({ url, viewport }) instead.
 * Kept so any external callers (or older tool code) don't break mid-migration.
 */
export async function getBrowser(url, viewport) {
  const { page } = await resolvePage({ url, viewport });
  return { browser, page };
}

// ─── Process cleanup (registered once) ───────────────────────────────────────

let cleanupRegistered = false;
function registerCleanup() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  const onSignal = async () => {
    await closeBrowser();
    process.exit(0);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}
registerCleanup();
