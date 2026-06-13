/**
 * error-guidance.js — smart error messages for known failure modes
 *
 * Two tiers:
 *   Tier 1 (every occurrence): short, specific, actionable hint — AI uses this
 *     to try a different approach without necessarily surfacing it to the human.
 *   Tier 2 (2nd+ occurrence of same error category this session): appends a
 *     pre-filled GitHub issue link. Signals a recurring problem worth reporting.
 *
 * Session state resets when the MCP server restarts.
 */

const GITHUB_NEW_ISSUE = "https://github.com/betson-g/browser-inspector-mcp/issues/new";

// In-memory session tracker — Map<errorCategory, count>
const sessionErrorCounts = new Map();

function trackError(category) {
  const count = (sessionErrorCounts.get(category) || 0) + 1;
  sessionErrorCounts.set(category, count);
  return count;
}

function issueLink(title) {
  const params = new URLSearchParams({
    title,
    body: "Steps to reproduce:\n\n- URL:\n- Selector:\n- Action called (dom/styles/screenshot/diff):\n- What you expected:\n- What happened:\n",
    labels: "user-report",
  });
  return `${GITHUB_NEW_ISSUE}?${params.toString()}`;
}

function escalationSuffix(category, count) {
  if (count < 2) return "";
  return ` If this keeps happening, it may be an edge case we haven't seen — report it here: ${issueLink(category)}`;
}

// ─── Selector pattern detectors ───────────────────────────────────────────────

// CSS Modules compiled class names — two common formats:
//   CRA/webpack: _abc123_ or _ComponentName_abc123_
//   Next.js/Vite: modulename__hash__localname (double underscores, 3 segments)
//   Note: BEM uses __ too (block__element) but only ever has 2 segments — the
//   three-segment check prevents false positives on BEM selectors.
const CSS_MODULES_CRA_RE = /_[a-zA-Z0-9]{4,}_/;
const CSS_MODULES_NEXT_RE = /[a-zA-Z0-9-]+__[a-zA-Z0-9-]{4,}__[a-zA-Z0-9-]+/;
function isCSSModulesSelector(selector) {
  return CSS_MODULES_CRA_RE.test(selector) || CSS_MODULES_NEXT_RE.test(selector);
}

// Portal-rendered components: these render outside their DOM parent
const PORTAL_KEYWORDS = [
  "dropdown", "modal", "dialog", "tooltip", "popover",
  "overlay", "drawer", "sheet", "menu", "combobox",
];

function detectSelectorCategory(selector) {
  if (isCSSModulesSelector(selector)) return "css-modules-hash";
  const lower = selector.toLowerCase();
  if (PORTAL_KEYWORDS.some((kw) => lower.includes(kw))) return "portal-component";
  return "not-found-generic";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a smart "not found" message for get_dom and inspect_styles.
 * Pass the selector and the current page URL.
 */
export function notFoundMessage(selector, pageUrl, hasIframes = false) {
  const category = detectSelectorCategory(selector);
  const count = trackError(category);
  const suffix = escalationSuffix(category, count);

  if (category === "css-modules-hash") {
    return (
      `No element matched "${selector}" on ${pageUrl}. ` +
      `The selector looks like a compiled CSS Modules class name — these are renamed at build time and won't match what's in source. ` +
      `Try calling \`dom\` on a parent element to see the actual rendered class names.` +
      suffix
    );
  }

  if (category === "portal-component") {
    return (
      `No element matched "${selector}" on ${pageUrl}. ` +
      `This component likely renders outside its DOM parent (a portal). ` +
      `Try: \`dom\` on \`body\` to scan for it, or use \`[role="dialog"]\`, \`[data-radix-popper-content-wrapper]\`, or the component's root attribute.` +
      suffix
    );
  }

  if (hasIframes) {
    const iframeCategory = "iframe-content";
    trackError(iframeCategory);
    const iframeSuffix = escalationSuffix(iframeCategory, sessionErrorCounts.get(iframeCategory));
    return (
      `No element matched "${selector}" on ${pageUrl}. ` +
      `The page contains iframes — if the element is inside one, navigate to the iframe URL directly. ` +
      `Use \`dom\` on the outer page first to find the iframe's \`src\` attribute.` +
      iframeSuffix
    );
  }

  return (
    `No element matched "${selector}" on ${pageUrl}. ` +
    `Check the selector or call \`dom\` on a parent element to see the actual rendered class names. ` +
    `The class names in source may differ from what the browser renders, especially with component libraries.` +
    suffix
  );
}

/**
 * Build a smart message for empty matchedRules in inspect_styles.
 * Pass whether the page uses CSS-in-JS (detected from blob/anonymous stylesheets).
 */
export function emptyRulesMessage(hasCSSInJS = false) {
  const category = hasCSSInJS ? "css-in-js-empty-rules" : "bare-element-no-rules";
  const count = trackError(category);
  const suffix = escalationSuffix(category, count);

  if (hasCSSInJS) {
    return (
      `No matched CSS rules found. The page uses CSS-in-JS — styles may be injected dynamically after initial load. ` +
      `Try calling \`styles\` again once the component has fully rendered, or check if the element is in a loading/skeleton state.` +
      suffix
    );
  }

  return (
    `No matched CSS rules found. This element may only have browser default styles, ` +
    `or styles may be applied via a parent rule that doesn't match this selector directly.` +
    suffix
  );
}

/**
 * Build a message for when diff detects no changes.
 */
export function noChangesMessage() {
  const category = "diff-no-change";
  const count = trackError(category);
  const suffix = escalationSuffix(category, count);

  return (
    `No style changes detected since the baseline snapshot. ` +
    `The CSS change may not have applied — check that the file was saved, hot reload completed, ` +
    `and the selector still targets the same element.` +
    suffix
  );
}

// ─── Attached-mode error helpers ──────────────────────────────────────────────

function platformChromeLaunchHint(port) {
  const platform = process.platform;
  if (platform === "darwin") {
    return `/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=${port}`;
  }
  if (platform === "win32") {
    return `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=${port}`;
  }
  return `google-chrome --remote-debugging-port=${port}   # or: chromium, chromium-browser`;
}

/**
 * Build a smart error for "can't reach Chrome on the debug port".
 * When managedError is provided, both attached and managed failed — append the managed failure.
 */
export function chromeDebugPortErrorMessage({ host, port, managedError } = {}) {
  const category = "chrome-debug-port";
  const count = trackError(category);
  const suffix = escalationSuffix(category, count);
  const launch = platformChromeLaunchHint(port);
  const debugProfile =
    process.platform === "win32"
      ? `${launch} --user-data-dir=%LOCALAPPDATA%\\chrome-debug-profile`
      : `${launch} --user-data-dir="$HOME/.chrome-debug-profile"`;

  const parts = [
    `Can't reach Chrome on ${host}:${port}.`,
    `Launch a dedicated debug Chrome (one-time setup), then leave it running:`,
    `    ${debugProfile}`,
    `The --user-data-dir is required: since Chrome 136, the debug port is silently ignored on your normal profile (a security measure), so it only works with a separate profile directory. This opens a dedicated Chrome you sign into once — it stays logged in and persists across restarts.`,
    `Note: it won't show your main profile's existing tabs — Chrome doesn't allow debugging that profile. Treat it as your dedicated "inspect this" browser. Use a stable path, not /tmp (which opens blank every time).`,
    `Escape hatch: set BROWSER_INSPECTOR_MODE=managed in your MCP config to use an internal headless Chrome instead — zero setup, headless.`,
  ];

  if (managedError) {
    parts.push(
      `Managed fallback also failed: ${managedError}`,
      `Try: npx puppeteer browsers install chrome`
    );
  }

  return parts.join("\n\n") + suffix;
}

/**
 * Build an error message for when a diff baseline's URL no longer matches the tab's current URL.
 */
export function diffStaleUrlMessage({ baselineUrl, currentUrl }) {
  const category = "diff-stale-url";
  const count = trackError(category);
  const suffix = escalationSuffix(category, count);
  return (
    `Baseline was captured on ${baselineUrl}, but the tab is now on ${currentUrl}. ` +
    `Navigate back to the baseline URL, or call diff again with reset: true to start a new baseline here.` +
    suffix
  );
}

/**
 * Build an error message for when the tab holding a diff baseline was closed.
 */
export function diffTabClosedMessage({ baselineUrl }) {
  const category = "diff-tab-closed";
  const count = trackError(category);
  const suffix = escalationSuffix(category, count);
  return (
    `The tab that held the baseline (${baselineUrl}) was closed. ` +
    `Re-open the page and call diff again with reset: true to start a new baseline.` +
    suffix
  );
}
