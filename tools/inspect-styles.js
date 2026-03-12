/**
 * inspect_styles — return the full CSS cascade for an element
 *
 * The examination. Call this when a style isn't applying as expected,
 * or to verify a computed value before assuming it needs changing.
 *
 * Uses CSS.getMatchedStylesForNode via CDP — the same data the DevTools
 * Styles panel shows: every rule that matched, which won, where it came from.
 */

import { getBrowser, getCDPSession } from "../browser.js";

export const INSPECT_STYLES_TOOL = {
  name: "inspect_styles",
  description:
    "Returns the full CSS cascade for an element: computed property values plus every CSS rule that matched the element, where each rule came from (stylesheet name and line number), and whether each property is active or overridden by a higher-specificity rule. Use this when a CSS change isn't showing up as expected, when you need to understand which rule is winning a specificity conflict, or to verify a computed value before assuming it needs to change.",
  inputSchema: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector for the element to inspect",
      },
      url: {
        type: "string",
        description:
          "URL of the running dev server. Required on first call. Optional on subsequent calls.",
      },
      viewport: {
        type: "object",
        description:
          "Optional: set the browser viewport before inspecting (e.g. {\"width\": 375, \"height\": 812} for mobile). Defaults to 1440×900. Use this when layout or styles change at different breakpoints.",
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
          "Optional: filter computed styles to only these property names (e.g. ['color', 'font-weight', 'display']). If omitted, returns the most useful computed properties.",
      },
    },
    required: ["selector"],
  },
};

// Computed properties we always return unless caller filters to something specific
const DEFAULT_COMPUTED_PROPERTIES = [
  "display",
  "position",
  "width",
  "height",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
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
  "border",
  "border-radius",
  "opacity",
  "overflow",
  "z-index",
  "box-sizing",
];

export async function inspectStyles({ selector, url, viewport, properties }) {
  const { page } = await getBrowser(url, viewport);
  const cdp = await getCDPSession();

  // Find the element
  const element = await page.$(selector);
  if (!element) {
    return {
      selector,
      found: false,
      message: `No element matched selector "${selector}" on ${page.url()}. Try get_dom first to verify the rendered class names.`,
    };
  }

  // Get the nodeId via CDP — use the CDP session's own DOM methods to avoid
  // cross-session objectId issues (puppeteer's internal session objectIds are
  // not valid in our separate cdpSession).
  const { root } = await cdp.send("DOM.getDocument", { pierce: true });
  const { nodeId: resolvedNodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  });

  if (!resolvedNodeId) {
    return {
      selector,
      found: false,
      message: `Element was found by puppeteer but could not be resolved via CDP DOM.querySelector. Try a simpler selector.`,
    };
  }

  // Fetch matched rules (the Styles panel data)
  const matchedResult = await cdp.send("CSS.getMatchedStylesForNode", {
    nodeId: resolvedNodeId,
  });

  // Fetch computed styles (the Computed panel data)
  const computedResult = await cdp.send("CSS.getComputedStyleForNode", {
    nodeId: resolvedNodeId,
  });

  // Build computed styles map, filtered to useful properties
  const wantedProps = properties || DEFAULT_COMPUTED_PROPERTIES;
  const computed = {};
  for (const { name, value } of computedResult.computedStyle) {
    if (wantedProps.includes(name)) {
      computed[name] = value;
    }
  }

  // Build matched rules, formatted for LLM consumption
  const matchedRules = [];

  for (const { rule, matchingSelectors } of matchedResult.matchedCSSRules ||
    []) {
    const source = resolveSource(rule);
    const activeSelectors = matchingSelectors.map(
      (i) => rule.selectorList.selectors[i].text
    );

    // Skip rules that only matched because of universal or bare-element selectors
    // (e.g. *, div, span). These are resets — not useful for debugging component styles.
    const allSelectorsAreGeneric = activeSelectors.every(isGenericSelector);
    if (allSelectorsAreGeneric) continue;

    const ruleProperties = [];
    for (const prop of rule.style?.cssProperties || []) {
      if (!prop.name || prop.name.startsWith("--") === false && !prop.value)
        continue;
      // Skip CSS custom property declarations (--tw-*, --ant-*, etc.) — they're
      // token definitions, not styles. They inflate output without helping debug.
      if (prop.name.startsWith("--")) continue;
      ruleProperties.push({
        name: prop.name,
        value: prop.value,
        important: prop.important || false,
      });
    }

    if (ruleProperties.length === 0) continue;

    matchedRules.push({
      matchingSelectors: activeSelectors,
      allSelectors: rule.selectorList.text,
      source,
      origin: rule.origin, // "user-agent", "regular", "inspector"
      properties: ruleProperties,
    });
  }

  // Inline styles (highest specificity, always wins)
  const inlineProperties = [];
  for (const prop of matchedResult.inlineStyle?.cssProperties || []) {
    if (prop.name && prop.value) {
      inlineProperties.push({
        name: prop.name,
        value: prop.value,
        important: prop.important || false,
      });
    }
  }

  return {
    selector,
    found: true,
    url: page.url(),
    computed,
    inlineStyles: inlineProperties.length > 0 ? inlineProperties : null,
    matchedRules,
    note:
      matchedRules.length === 0
        ? "No matched CSS rules found. The element may only have user-agent styles."
        : null,
  };
}

// Returns true for selectors that match everything and carry no component-specific
// intent: *, ::before, ::after, div, span, p, etc.
// These rules are CSS resets — they don't help identify why a specific component
// looks the way it does, and they inflate output massively on CSS-in-JS apps.
const BARE_ELEMENT_RE = /^[a-z][a-z0-9]*$/i;
const PSEUDO_UNIVERSAL_RE = /^(::|:)?(before|after|root|where|is|not|has|placeholder|focus|hover|active|visited|first-child|last-child|nth-child|first-of-type|last-of-type|checked|disabled|enabled|empty|link|any-link|local-link|scope|target|default|valid|invalid|required|optional|read-only|read-write|in-range|out-of-range|indeterminate|fullscreen|focus-within|focus-visible)$/i;

function isGenericSelector(selector) {
  const s = selector.trim();
  // Universal selector
  if (s === "*") return true;
  // Pseudo-elements on universal: ::before, ::after, *::before etc.
  if (s === "::before" || s === "::after" || s === "*::before" || s === "*::after") return true;
  // Bare HTML element name with no class, id, attribute, or pseudo-class qualifier
  if (BARE_ELEMENT_RE.test(s)) return true;
  return false;
}

function resolveSource(rule) {
  if (!rule.styleSheetId) {
    if (rule.origin === "user-agent") return "browser default (user-agent stylesheet)";
    if (rule.origin === "inspector") return "DevTools inspector override";
    return "unknown";
  }

  // sourceURL is available on the rule's style in some CDP versions
  const url = rule.style?.sourceURL || rule.styleSheetId;

  // Clean up common patterns to make the source readable
  if (url.includes("blob:") || url.includes("<anonymous>")) {
    return "injected stylesheet (CSS-in-JS / runtime)";
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    // Strip the origin to keep it short
    try {
      const parsed = new URL(url);
      return parsed.pathname + (rule.style?.range ? `:${rule.style.range.startLine + 1}` : "");
    } catch {
      return url;
    }
  }

  return url;
}
