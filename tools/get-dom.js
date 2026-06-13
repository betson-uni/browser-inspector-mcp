/**
 * get_dom — return the rendered DOM of an element
 *
 * The fitting room. Call this before writing any CSS.
 * What you see in source is not always what the browser renders.
 */

import { resolvePage } from "../browser.js";
import { notFoundMessage } from "./error-guidance.js";

export const GET_DOM_TOOL = {
  name: "get_dom",
  description:
    "Returns the rendered HTML of an element in the live browser — actual class names, DOM structure, and attributes as they exist at runtime. Call this before writing any CSS that targets a specific element. The class names in source code and JSX may differ from what the browser actually renders, especially with component libraries like Ant Design, Material UI, or Radix. This is the ground truth.",
  inputSchema: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description:
          "CSS selector for the element to inspect (e.g. '.dropdown-menu', '#header', '[data-testid=\"submit\"]')",
      },
      url: {
        type: "string",
        description:
          "URL of the running dev server to inspect (e.g. 'http://localhost:5173'). Required on first call. Optional on subsequent calls — reuses the open browser.",
      },
      viewport: {
        type: "object",
        description:
          "Optional: set the browser viewport before inspecting (e.g. {\"width\": 375, \"height\": 812} for mobile). Defaults to 1440×900.",
        properties: {
          width: { type: "number" },
          height: { type: "number" },
        },
        required: ["width", "height"],
      },
    },
    required: ["selector"],
  },
};

export async function getDom({ selector, url, viewport, openInNewTab }) {
  const { page, mode, warning } = await resolvePage({ url, viewport, openInNewTab });

  // Check element exists
  const element = await page.$(selector);
  if (!element) {
    // Detect iframes on the page — element may be inside one
    const hasIframes = await page.$$eval("iframe", (frames) => frames.length > 0).catch(() => false);
    return {
      selector,
      found: false,
      mode,
      ...(warning ? { warning } : {}),
      message: notFoundMessage(selector, page.url(), hasIframes),
    };
  }

  // Get the rendered outerHTML
  const outerHTML = await page.$eval(selector, (el) => el.outerHTML);

  // Get class list and tag info for easy scanning
  const info = await page.$eval(selector, (el) => ({
    tagName: el.tagName,
    classList: Array.from(el.classList),
    id: el.id || null,
    childCount: el.children.length,
    attributes: Object.fromEntries(
      Array.from(el.attributes)
        .filter((a) => a.name !== "class" && a.name !== "id") // already captured above
        .map((a) => [a.name, a.value])
    ),
  }));

  return {
    selector,
    found: true,
    mode,
    ...(warning ? { warning } : {}),
    url: page.url(),
    tagName: info.tagName,
    id: info.id,
    classList: info.classList,
    childCount: info.childCount,
    attributes: info.attributes,
    outerHTML,
  };
}
