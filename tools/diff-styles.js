/**
 * diff_styles — compare computed styles before and after a CSS change
 *
 * Closes the feedback loop. Call once before making a CSS change (saves
 * a baseline), then again after (returns what changed).
 *
 * Snapshots are keyed by selector+URL so the baseline is tied to the page
 * it was captured on. If the user navigates between baseline and diff, we
 * surface an explicit error instead of returning nonsense.
 *
 * Baselines older than 10 minutes are discarded.
 */

import { resolvePage, getCDPSession } from "../browser.js";
import {
  noChangesMessage,
  diffStaleUrlMessage,
  diffTabClosedMessage,
} from "./error-guidance.js";

export const DIFF_STYLES_TOOL = {
  name: "diff_styles",
  description:
    "Compares computed styles before and after a CSS change to verify the change took effect. Call once before making a change (saves a baseline snapshot), then again after (returns exactly what changed). If nothing changed, that means the CSS didn't apply — check specificity with inspect_styles. Snapshot is cleared after each diff so you can run multiple rounds.",
  inputSchema: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector for the element to track",
      },
      url: {
        type: "string",
        description:
          "URL of the running dev server. Required on first call. Optional on subsequent calls.",
      },
      viewport: {
        type: "object",
        description: "Optional: set the browser viewport before capturing.",
        properties: {
          width: { type: "number" },
          height: { type: "number" },
        },
        required: ["width", "height"],
      },
      reset: {
        type: "boolean",
        description:
          "Optional: pass true to discard any existing snapshot for this selector and start fresh.",
      },
    },
    required: ["selector"],
  },
};

// In-memory snapshots keyed by `${selector}::${normalizedUrl}`
const snapshots = new Map();
const STALENESS_MS = 10 * 60 * 1000; // 10 minutes

function normalizeForKey(rawUrl) {
  try {
    const u = new URL(rawUrl);
    let pathname = u.pathname || "/";
    if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    return u.origin.toLowerCase() + pathname;
  } catch {
    return rawUrl || "";
  }
}

function snapshotKey(selector, pageUrl) {
  return `${selector}::${normalizeForKey(pageUrl)}`;
}

// Properties we track for diffs — same set inspect_styles uses by default
const TRACKED_PROPERTIES = [
  "display",
  "position",
  "width",
  "height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "font-family",
  "line-height",
  "text-align",
  "flex-direction",
  "align-items",
  "justify-content",
  "gap",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "opacity",
  "overflow",
  "overflow-x",
  "overflow-y",
  "z-index",
  "box-shadow",
  "transform",
  "visibility",
  "pointer-events",
  "cursor",
];

async function readComputedStyles(page, cdp, selector) {
  const element = await page.$(selector);
  if (!element) {
    return { found: false };
  }

  const { root } = await cdp.send("DOM.getDocument", { pierce: true });
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  });

  if (!nodeId) {
    return { found: false };
  }

  const { computedStyle } = await cdp.send("CSS.getComputedStyleForNode", { nodeId });

  const styles = {};
  for (const { name, value } of computedStyle) {
    if (TRACKED_PROPERTIES.includes(name)) {
      styles[name] = value;
    }
  }

  return { found: true, styles };
}

// Find any snapshot for this selector regardless of URL — used to detect
// URL drift and emit a clear error rather than treating the new URL as
// a fresh baseline.
function findAnySnapshotForSelector(selector) {
  const prefix = `${selector}::`;
  for (const [key, value] of snapshots) {
    if (key.startsWith(prefix)) return { key, value };
  }
  return null;
}

function isStale(snapshot) {
  return Date.now() - snapshot.capturedAt > STALENESS_MS;
}

export async function diffStyles({ selector, url, viewport, reset, openInNewTab }) {
  if (reset) {
    // Drop all snapshots for this selector
    for (const key of [...snapshots.keys()]) {
      if (key.startsWith(`${selector}::`)) snapshots.delete(key);
    }
  }

  const { page, mode, warning } = await resolvePage({ url, viewport, openInNewTab });
  const cdp = await getCDPSession(page);

  const pageUrl = page.url();
  const key = snapshotKey(selector, pageUrl);

  // Check for a stale baseline on a different URL before doing any work
  const existing = findAnySnapshotForSelector(selector);
  if (existing && existing.key !== key && !isStale(existing.value)) {
    return {
      selector,
      status: "stale_url",
      mode,
      ...(warning ? { warning } : {}),
      message: diffStaleUrlMessage({
        baselineUrl: existing.value.url,
        currentUrl: pageUrl,
      }),
    };
  }

  // If the stored baseline is stale, discard it so we capture fresh
  if (existing && isStale(existing.value)) {
    snapshots.delete(existing.key);
  }

  const current = await readComputedStyles(page, cdp, selector);
  if (!current.found) {
    return {
      selector,
      found: false,
      mode,
      ...(warning ? { warning } : {}),
      message: `No element matched selector "${selector}" on ${pageUrl}. Try get_dom first to verify the rendered class names.`,
    };
  }

  // No snapshot yet — save this as the baseline
  if (!snapshots.has(key)) {
    snapshots.set(key, {
      url: pageUrl,
      capturedAt: Date.now(),
      computed: current.styles,
    });
    return {
      selector,
      status: "snapshot_saved",
      mode,
      ...(warning ? { warning } : {}),
      url: pageUrl,
      message: `Baseline saved for "${selector}" on ${pageUrl}. Make your CSS change, then call diff_styles again to see what changed.`,
      captured_properties: Object.keys(current.styles).length,
      snapshot: current.styles,
    };
  }

  // Snapshot exists — diff against it
  const baseline = snapshots.get(key);
  snapshots.delete(key); // clear after use, ready for next round

  const changed = [];
  const allKeys = new Set([...Object.keys(baseline.computed), ...Object.keys(current.styles)]);

  for (const prop of allKeys) {
    const before = baseline.computed[prop] ?? "(not set)";
    const after = current.styles[prop] ?? "(not set)";
    if (before !== after) {
      changed.push({ property: prop, before, after });
    }
  }

  return {
    selector,
    status: changed.length > 0 ? "changed" : "no_change",
    mode,
    ...(warning ? { warning } : {}),
    url: pageUrl,
    changed,
    unchanged_count: allKeys.size - changed.length,
    message:
      changed.length === 0
        ? noChangesMessage()
        : `${changed.length} propert${changed.length === 1 ? "y" : "ies"} changed on "${selector}".`,
  };
}

// Re-export for error-guidance consumers that may import from here
export { diffTabClosedMessage };
