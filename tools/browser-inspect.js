/**
 * browser_inspect — unified entry point for all browser inspection actions
 *
 * One tool, four actions. Claude picks the right action based on context.
 * The underlying tool logic is unchanged — this is purely a surface simplification.
 *
 * actions:
 *   dom        — get the rendered HTML structure of an element
 *   styles     — get the full CSS cascade for an element
 *   screenshot — capture a visual snapshot of an element
 *   diff       — compare styles before/after a CSS change
 *   help       — plain-English explanation of what this tool can do
 */

import { getDom } from "./get-dom.js";
import { inspectStyles } from "./inspect-styles.js";
import { screenshotElement } from "./screenshot-element.js";
import { diffStyles } from "./diff-styles.js";

export const BROWSER_INSPECT_TOOL = {
  name: "browser_inspect",
  description:
    "Inspects a live browser page to get CSS and DOM information — the same data a human sees in browser DevTools. Use this before writing or debugging CSS to verify what the browser actually renders, not just what the source code says. Four actions available: 'dom' gets the rendered HTML structure, 'styles' gets the full CSS cascade, 'screenshot' captures a visual snapshot, 'diff' compares styles before and after a change. Call with action 'help' if unsure.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["dom", "styles", "screenshot", "diff", "help"],
        description:
          "'dom' — get real rendered HTML and class names. 'styles' — get all CSS rules, computed values, and which rule is winning. 'screenshot' — capture a visual snapshot of an element. 'diff' — compare styles before/after a CSS change to verify it applied. 'help' — explain what this tool can do.",
      },
      selector: {
        type: "string",
        description:
          "CSS selector for the element to inspect (e.g. '.dropdown-menu', '#header', 'button.primary'). Required for all actions except 'help'.",
      },
      url: {
        type: "string",
        description:
          "URL of the running dev server (e.g. 'http://localhost:5173'). Required on the first call. Optional on subsequent calls — reuses the open browser tab.",
      },
      viewport: {
        type: "object",
        description:
          "Optional: browser viewport size before inspecting (e.g. {\"width\": 375, \"height\": 812} for mobile). Defaults to 1440×900.",
        properties: {
          width: { type: "number" },
          height: { type: "number" },
        },
        required: ["width", "height"],
      },
      properties: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional, 'styles' action only: filter computed styles to specific property names (e.g. ['color', 'border', 'display']). If omitted, returns the most useful set by default.",
      },
      padding: {
        type: "number",
        description:
          "Optional, 'screenshot' action only: pixels of padding around the element (default: 8). Increase for more visual context.",
      },
      reset: {
        type: "boolean",
        description:
          "Optional, 'diff' action only: pass true to discard any existing snapshot and start a fresh baseline.",
      },
    },
    required: ["action"],
  },
};

const HELP_TEXT = `Here's what browser_inspect can do:

**dom** — Get the real rendered HTML of an element.
The browser often renders different class names than what's in the source code, especially with component libraries like Ant Design or Material UI. Start here when you're unsure which selector to target.
Example: "what does the header actually look like in the DOM?"

**styles** — Get the full CSS cascade for an element.
Shows every CSS rule that matched, which rule is winning, where each rule came from (stylesheet name and line), and computed values. Use this when a style isn't applying or you need to understand a specificity conflict.
Example: "why isn't my border showing on .card?"

**screenshot** — Capture a visual snapshot of an element.
Returns a cropped image of the element as it renders in the browser. Use for visual confirmation before or after a CSS change.
Example: "show me what the send button looks like right now"

**diff** — Compare styles before and after a CSS change.
Call once before making a change (saves a baseline), then again after (shows exactly what changed). If nothing changed, the CSS didn't apply — use 'styles' to check why.
Example: "did my border-radius change actually take effect?"

**Tip:** When in doubt, start with 'dom' to get the real class names, then use 'styles' to inspect the element you found.`;

export async function browserInspect(args) {
  const { action, selector, url, viewport, properties, padding, reset } = args;

  if (action === "help") {
    return { help: HELP_TEXT };
  }

  if (!selector) {
    return {
      error: `'selector' is required for action '${action}'. Provide a CSS selector (e.g. '.my-class', '#id', 'button'). If you're unsure of the right selector, use action 'dom' on a parent element first, or call with action 'help' for guidance.`,
    };
  }

  if (action === "dom") {
    return getDom({ selector, url, viewport });
  }

  if (action === "styles") {
    return inspectStyles({ selector, url, viewport, properties });
  }

  if (action === "screenshot") {
    return screenshotElement({ selector, url, viewport, padding });
  }

  if (action === "diff") {
    return diffStyles({ selector, url, viewport, reset });
  }
}
