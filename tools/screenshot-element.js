/**
 * screenshot_element — capture a cropped screenshot of a specific element
 *
 * Visual confirmation. Call this after making a CSS change to see if it
 * looks right, or to get a visual reference before writing styles.
 *
 * Crops tightly to the element's bounding box with a small padding margin.
 * Returns the image directly so Claude can see the result inline.
 */

import { getBrowser } from "../browser.js";

export const SCREENSHOT_ELEMENT_TOOL = {
  name: "screenshot_element",
  description:
    "Captures a screenshot cropped to a specific element in the live browser. Use this for visual confirmation after a CSS change, or to see what an element actually looks like before writing styles. Returns the element image inline. Pairs well with inspect_styles — use inspect_styles to understand the CSS, screenshot_element to see the visual result.",
  inputSchema: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector for the element to screenshot",
      },
      url: {
        type: "string",
        description:
          "URL of the running dev server. Required on first call. Optional on subsequent calls.",
      },
      viewport: {
        type: "object",
        description:
          'Optional: set the browser viewport before capturing (e.g. {"width": 375, "height": 812} for mobile).',
        properties: {
          width: { type: "number" },
          height: { type: "number" },
        },
        required: ["width", "height"],
      },
      padding: {
        type: "number",
        description:
          "Pixels of padding to add around the element (default: 8). Increase if you want more visual context.",
      },
    },
    required: ["selector"],
  },
};

export async function screenshotElement({ selector, url, viewport, padding = 8 }) {
  const { page } = await getBrowser(url, viewport);

  const element = await page.$(selector);
  if (!element) {
    return {
      selector,
      found: false,
      message: `No element matched selector "${selector}" on ${page.url()}. Try get_dom first to verify the rendered class names.`,
    };
  }

  const box = await element.boundingBox();
  if (!box) {
    return {
      selector,
      found: true,
      message: `Element matched but has no bounding box — it may be hidden (display:none or visibility:hidden).`,
    };
  }

  const clip = {
    x: Math.max(0, box.x - padding),
    y: Math.max(0, box.y - padding),
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  };

  const imageBuffer = await page.screenshot({ clip, type: "png" });
  const base64 = imageBuffer.toString("base64");

  return {
    selector,
    found: true,
    url: page.url(),
    dimensions: {
      width: Math.round(box.width),
      height: Math.round(box.height),
    },
    image: base64,
  };
}
