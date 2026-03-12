/**
 * browser.js — Chrome lifecycle + CDP session management
 *
 * Launches a managed Chrome instance on first use.
 * Keeps it open for the session. Closes on process exit.
 * One browser, one page, one CDP session per MCP server instance.
 */

import puppeteer from "puppeteer";

let browser = null;
let page = null;
let cdpSession = null;
let currentViewport = { width: 1440, height: 900 };

export async function getBrowser(url, viewport) {
  // Validate existing state — browser or page may have been closed/detached externally
  if (browser && !browser.isConnected()) {
    browser = null;
    page = null;
    cdpSession = null;
  } else if (page && page.isClosed()) {
    page = null;
    cdpSession = null;
  }

  if (!browser) {
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
        ],
      });

      page = await browser.newPage();
      await page.setViewport(currentViewport);

      // Clean up on process exit
      process.on("exit", () => browser?.close());
      process.on("SIGINT", () => browser?.close());
      process.on("SIGTERM", () => browser?.close());
    } catch (err) {
      browser = null;
      page = null;
      cdpSession = null;
      throw new Error(`Chrome failed to launch: ${err.message}`);
    }
  }

  // Apply viewport if provided and different from current
  if (viewport) {
    const vp = { width: viewport.width, height: viewport.height };
    if (vp.width !== currentViewport.width || vp.height !== currentViewport.height) {
      await page.setViewport(vp);
      currentViewport = vp;
      // CDP session is tied to the page context — invalidate it so it's recreated
      // after the viewport change to avoid stale layout state
      cdpSession = null;
    }
  }

  // Navigate if a URL is provided and differs from current
  if (url) {
    const currentUrl = page.url();
    if (currentUrl === "about:blank" || currentUrl !== url) {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    }
  }

  return { browser, page };
}

export async function getCDPSession() {
  if (!page) {
    throw new Error(
      "No browser page open. Call get_dom or inspect_styles with a url parameter first."
    );
  }

  if (!cdpSession) {
    cdpSession = await page.createCDPSession();
    await cdpSession.send("DOM.enable");
    await cdpSession.send("CSS.enable");
  }

  return cdpSession;
}

export async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
    cdpSession = null;
  }
}
