/**
 * diff_styles — compare computed styles before and after a CSS change
 *
 * Closes the feedback loop. Call once before making a CSS change (saves
 * a baseline), then again after (returns what changed).
 *
 * First call  → saves baseline, confirms what was captured
 * Second call → diffs current styles against baseline, shows what changed
 *
 * Snapshots are stored in memory per selector. After a diff is returned,
 * the snapshot is cleared — ready for the next round.
 */

import { getBrowser, getCDPSession } from "../browser.js";

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

// In-memory snapshots keyed by selector
const snapshots = new Map();

// Properties we track for diffs — the same set inspect_styles uses by default
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

async function getComputedStyles(selector, url, viewport) {
  const { page } = await getBrowser(url, viewport);
  const cdp = await getCDPSession();

  const element = await page.$(selector);
  if (!element) {
    return { found: false, url: page.url() };
  }

  const { root } = await cdp.send("DOM.getDocument", { pierce: true });
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  });

  if (!nodeId) {
    return { found: false, url: page.url() };
  }

  const { computedStyle } = await cdp.send("CSS.getComputedStyleForNode", { nodeId });

  const styles = {};
  for (const { name, value } of computedStyle) {
    if (TRACKED_PROPERTIES.includes(name)) {
      styles[name] = value;
    }
  }

  return { found: true, url: page.url(), styles };
}

export async function diffStyles({ selector, url, viewport, reset }) {
  if (reset) {
    snapshots.delete(selector);
  }

  const current = await getComputedStyles(selector, url, viewport);

  if (!current.found) {
    return {
      selector,
      found: false,
      message: `No element matched selector "${selector}" on ${current.url}. Try get_dom first to verify the rendered class names.`,
    };
  }

  // No snapshot yet — save this as the baseline
  if (!snapshots.has(selector)) {
    snapshots.set(selector, current.styles);
    return {
      selector,
      status: "snapshot_saved",
      url: current.url,
      message: `Baseline saved for "${selector}". Make your CSS change, then call diff_styles again to see what changed.`,
      captured_properties: Object.keys(current.styles).length,
      snapshot: current.styles,
    };
  }

  // Snapshot exists — diff against it
  const baseline = snapshots.get(selector);
  snapshots.delete(selector); // clear after use, ready for next round

  const changed = [];
  const allKeys = new Set([...Object.keys(baseline), ...Object.keys(current.styles)]);

  for (const prop of allKeys) {
    const before = baseline[prop] ?? "(not set)";
    const after = current.styles[prop] ?? "(not set)";
    if (before !== after) {
      changed.push({ property: prop, before, after });
    }
  }

  return {
    selector,
    status: changed.length > 0 ? "changed" : "no_change",
    url: current.url,
    changed,
    unchanged_count: allKeys.size - changed.length,
    message:
      changed.length === 0
        ? `No computed style changes detected on "${selector}". The CSS change may not have applied — check specificity with inspect_styles.`
        : `${changed.length} propert${changed.length === 1 ? "y" : "ies"} changed on "${selector}".`,
  };
}
