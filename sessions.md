# Browser CSS Inspector MCP — Session Log

> Running log of sessions, decisions, and real-world incidents.
> Grows over time. Raw and honest — not polished.
> Source material for the case study that gets written after v1 ships.

---

## Session Log

### 2026-03-05 — Origin

**Context:** Deep in a working session on a React design system. Fixing a dropdown menu component. CSS wasn't applying. Multiple push-check-fail cycles. Eventually the fix required inspecting the browser DOM manually and pasting it back into the Claude chat.

**The moment:** After the fix worked, the question came naturally — "Is there a Claude tool or third-party tool that could have done that automatically?" Not a planned brainstorm. An organic frustration that turned into a question that turned into an idea.

**First instinct:** Check if Playwright MCP or something similar already solved this. It doesn't — not at the specificity level needed.

**Second instinct:** What would the ideal version look like? Started describing it. It got interesting fast.

**Third instinct (the diverge):** Don't lock in yet. What are the adjacent ideas? The browser selection handoff came up. The before/after PR visual came up. Resisted the urge to pick one direction — captured all of them instead.

**Decision:** Write it all down. Start a new session in its own space. Come back with fresh eyes before touching any code.

**Emotional note:** This felt good. That feeling of "I want to do something with this" is worth trusting. Following it.

---

### 2026-03-11 — Research, Devil's Advocate, Strategic Reframe, File Structure

**What happened:**
Returned to the project with fresh eyes. Before any code: full landscape research, devil's advocate analysis, expert validation, problem deepening, and file restructure.

**Research findings:**

- **Google's `chrome-devtools-mcp`** (September 2025) does not implement `CSS.getMatchedStylesForNode`. GitHub Issue #86 is an explicit open feature request — filed immediately after launch. Google's own DevTools team acknowledged the gap.
- **`devtoolcss/chrome-inspector-mcp`** wraps `CSS.getMatchedStylesForNode` via a Chrome extension relay. Small, low adoption, no docs polish. Technical proof of concept exists; the product doesn't.
- **Playwright MCP** uses the accessibility tree. Known open bug: DOM snapshots don't collect styles. No cascade data.
- **Browser extension tools** (Web to MCP, SightRelay, ContextBox) capture computed styles, not cascade. Faster than manual paste, same structural limitation.
- **`chrome-remote-interface`** actively maintained (~21 days since latest release). Right foundation for Phase 1.

**Devil's advocate — what survived:**
The `devtoolcss/chrome-inspector-mcp` partial solution is the real competitive question. Someone built this. The remaining challenge is execution, adoption, and documentation — not the technical problem.

**Devil's advocate — what died:**
"Playwright covers 80% of it" — false, confirmed by the open Playwright bug.
"The problem is a model limitation" — partially true, but independent of the tooling gap.

**Strategic reframe:**
Question shifted from "should this exist?" to "what's the version Google can't make redundant?" Answer: opinionated, scoped to the CSS debugging workflow, documented from the designer's angle.

**Problem deepening:**
Three problems were separated and named:
1. AI reads source tree, browser renders different tree → wrong element targeted
2. No feedback loop after a change → human is the wire between action and result
3. Acting on an assumption without verifying → solving the wrong problem

Problems 1 and 3 are solved by `get_dom` and `inspect_styles`. Problem 2 (`diff_styles`) is Phase 2 and lower priority since it depends on workflow (local dev vs push to branch).

**Connection model decision:**
Option B chosen — launch managed Chrome via puppeteer-core. Zero setup for the user. No `--remote-debugging-port` flag required. A tool that works with zero setup is a tool people actually use.

**Analogies captured:**
Three plain-language analogies written for use in posts and README:
- Tailor / fitting room (Problem 1)
- TV aerial / blind adjustment (Problem 2)
- Doctor / wrong diagnosis (Problem 3)

Cross-domain pattern: every robust system has a verification step before action, not after. The inspector is the fitting room.

**File structure:**
Split the original single brainstorm file into:
- `browser-inspector-mcp.md` — index, status, orientation
- `thinking.md` — strategy, problem, ideas, philosophy (shareable)
- `sessions.md` — this file, running log
- `spec.md` — Phase 1 spec, to be written

**Next:** Write Phase 1 spec in spec.md, then build.

---

### 2026-03-11 (continued) — Phase 1 Built

**What was built:**

All Phase 1 code written and installed. MCP server is wired into Claude Code config and ready to test on restart.

Files created:
- `browser-inspector-mcp/index.js` — MCP server, registers both tools, stdio transport
- `browser-inspector-mcp/browser.js` — managed Chrome lifecycle via puppeteer, CDP session management
- `browser-inspector-mcp/tools/get-dom.js` — `get_dom` tool
- `browser-inspector-mcp/tools/inspect-styles.js` — `inspect_styles` tool using `CSS.getMatchedStylesForNode`
- `browser-inspector-mcp/README.md` — install + config instructions

**Connection model:** puppeteer launches Chrome on first tool call. Browser stays open for the session. No `--remote-debugging-port` flag required.

**MCP config:** `browser-inspector` added to `~/.claude.json` mcpServers. Activate by restarting Claude Code.

**Status:** Ready to test. Next step is a live test against a real dev server — run `get_dom` on any component, verify the rendered class names come back correctly, then try `inspect_styles` on something with a known CSS conflict.

**Key technical note:** The nodeId resolution in `inspect-styles.js` uses `DOM.describeNode` + `DOM.pushNodesByBackendIdsToFrontend` to convert a puppeteer element handle to a CDP nodeId. This is the correct path — `DOM.getNodeForValue` is not a real CDP method and was caught and corrected before shipping.

---

### 2026-03-11 — First Live Test + Bug Fix

**Context:** First session after Phase 1 build. MCP server confirmed connected (both tools visible in Claude Code's deferred tool list). Test target: `http://localhost:5173/views/dashboard` — the UniversalThemeReactLib dev runtime.

**`get_dom` result: PASS**

Called `get_dom('body', url)`. Browser launched (headless: false — visible), navigated to the dashboard, returned the full rendered DOM including antd runtime class names (`css-dev-only-do-not-override-tchc97`, `css-var-r1`, `ant-menu-item-selected`, etc.). Exactly what the tool is supposed to do. Tool description is correctly wired — showed up in Claude's tool list without any prompting.

**`inspect_styles` result: FAIL — bug found and fixed**

Called `inspect_styles('.ant-menu-item-selected')`. Error: `Protocol error (DOM.describeNode): Could not find object with given id`.

**Root cause:** Cross-session objectId problem. Puppeteer uses its own internal CDP session to create element handles. The `remoteObject().objectId` returned by `element.evaluateHandle()` is scoped to puppeteer's session. Our custom `cdpSession` (created via `page.createCDPSession()`) is a separate session — objectIds are not shared across CDP sessions. So `DOM.describeNode({ objectId })` fails.

**Fix applied to `inspect-styles.js`:** Replaced the `evaluateHandle` → `remoteObject` → `DOM.describeNode` → `DOM.pushNodesByBackendIdsToFrontend` chain with:
```js
const { root } = await cdp.send("DOM.getDocument", { pierce: true });
const { nodeId: resolvedNodeId } = await cdp.send("DOM.querySelector", {
  nodeId: root.nodeId,
  selector,
});
```
CDP session finds the node itself — no cross-session objectId involved. Simpler and more reliable.

**Note:** The previous session log entry said `DOM.describeNode` + `DOM.pushNodesByBackendIdsToFrontend` was "the correct path." It's a valid CDP pattern but requires using the *same* session that created the objectId. Our architecture creates a separate `cdpSession`, so the correct path is `DOM.getDocument` + `DOM.querySelector`.

**Status:** Fix is on disk. MCP server needs restart to pick it up (ES modules cached at import time). Next: restart Claude Code, re-test `inspect_styles`, then verify full cascade output for an antd component.

---

### 2026-03-11 (continued) — Second Live Test + Bug Fix #2

**Context:** Restart after Bug Fix #1 (cross-session objectId). `inspect_styles` verified working — called on `.ant-menu-item-selected`, returned full cascade including antd CSS-in-JS rules, Tailwind reset, user-agent defaults. Phase 1 criteria 1–4 confirmed passed.

**New failure:** Immediately after, called `get_dom('header', url)` to inspect dashboard header borders. Error: `Attempted to use detached Frame 'A8FA50B801AD9BCB02FB0BEA80E9D8CA'`. Second call with same args also failed.

**Root cause:** `getBrowser()` only checks `if (!browser)` — never validates that the existing `page` or browser is still in a good state. If the Chrome window was closed externally between tool calls (or the page was detached for any reason), the stale `page` reference is returned and every subsequent operation fails. `browser` and `page` were non-null but the frame was dead.

**Fix applied to `browser.js`:** Added state validation at the top of `getBrowser` before any reuse:
```js
if (browser && !browser.isConnected()) {
  browser = null;
  page = null;
  cdpSession = null;
} else if (page && page.isClosed()) {
  page = null;
  cdpSession = null;
}
```
If the browser process is gone, full reset and relaunch. If just the page was closed, reset page and CDP session — browser reuse is still possible (though in practice we only ever have one page).

**Pattern:** Same class of bug as Bug #1 — stale reference held across a state change. The module-level variables (`browser`, `page`, `cdpSession`) are never invalidated by external events. Each fix adds a validation gate. A more complete solution would listen to `browser.on('disconnected')` and `page.on('close')` to invalidate proactively — Phase 2 hardening candidate.

**Status:** Fix on disk. Requires restart to pick up. Pending: re-test `get_dom` + answer the original question (dashboard header border sizes).

---

### 2026-03-11 (continued) — Third Live Test: Header Border Inspection

**Context:** Restart after Bug Fix #2 (stale frame validation). Both tools confirmed healthy — Chrome relaunched cleanly, no stale-reference errors.

**Task:** Inspect border and shadow styles on the dashboard header.

**`get_dom('.host-shell', url)` result: PASS**

`<header>` selector returned no match — the header is a `<div>`, not a semantic `<header>` element. This is the exact problem the tool was built to solve: source-code assumption (`header` tag) vs. runtime reality (`div.host-shell-header`). The DOM output revealed the correct selector immediately.

**`inspect_styles('.host-shell-header', [...border props])` result: PASS**

Full cascade returned. Key findings:

**Border on the header:**
- `border-bottom: 1px solid var(--ut-color-shell-border)` — the only active border rule, set in `.host-shell-header` (style-sheet-24707-20)
- No `border-top`, `border-left`, `border-right`
- No `border-radius`
- No `box-shadow` (computed value: `none`)
- No `outline`

The header has exactly one border — a 1px solid bottom border using the shell border token. Nothing else.

**Source:** The rule lives in the project's own SCSS (not antd CSS-in-JS), selector `.host-shell-header`, no `!important` flag. Straightforward to override if needed.

**Observation — `selector` not `<header>` tag:** Confirms the general rule from the incident archive: never guess element type from component name. The HostShell header is a `div`. `get_dom` on a parent is always the right first step before writing any CSS.

**Phase 1 status:** All criteria confirmed across three live sessions. Both tools working correctly after two bug fixes.

---

---

### 2026-03-11 (continued) — Bug Fix #3: Launch failure leaves null state

**Trigger:** After closing Chrome and restarting Claude Code, both tools errored with `Cannot read properties of null (reading '$')` and `Cannot read properties of null (reading 'url')`.

**Root cause:** The `if (!browser)` launch block in `getBrowser()` had no try/catch. If `puppeteer.launch()` throws (Chrome not found, crash during startup, etc.), it throws before `page` gets assigned. `browser` may also be partially set or not — state is undefined. The rest of the function then hits `page.$()` or `page.url()` on a null reference and throws an unhelpful error.

**Fix applied to `browser.js`:** Wrapped the launch block in try/catch. On any launch failure, reset all three variables to null and throw a clean error:
```js
} catch (err) {
  browser = null;
  page = null;
  cdpSession = null;
  throw new Error(`Chrome failed to launch: ${err.message}`);
}
```

**Pattern:** Third bug in the same class — stale or invalid state not caught at the right boundary. Bug #1: cross-session objectId. Bug #2: stale page/browser reference from external close. Bug #3: failed launch leaves variables in unknown state. The module-level variables are the common thread. Each fix adds a guard at a different failure point.

**Status:** Fix on disk. Requires restart to pick up.

---

### 2026-03-11 (continued) — Phase 1 Verification + Two New Fixes

**Context:** New session after Bug Fix #3 was written. Opened project from a different folder — resumed from the session summary pasted as context.

**Bug Fix #3 verified:** Both tools working cleanly after restart. Chrome launched without error. `get_dom` on `example.com` (body) → PASS. `inspect_styles` on `h1` → PASS. Cascade data correct, session reuse working.

**Switched to real project:** Navigated to `http://localhost:5173/` (UniversalThemeReactLib dev runtime, Dashboard view). `get_dom` on `body` returned full rendered React DOM including antd runtime class names, AI assist panel, side nav, metric cards, ECharts canvases. Tool navigated correctly and redirected to `/views/dashboard`.

**Two new issues found and fixed:**

**Issue 1 — Viewport is fixed, can't be changed per call:**
The screenshot showed the app rendering at a collapsed state because viewport was hardcoded at 1440×900 at launch and never updated. This means inspecting a mobile breakpoint is impossible without restarting and changing the source. Added optional `viewport: {width, height}` parameter to both `get_dom` and `inspect_styles`. `browser.js` now tracks `currentViewport` and calls `page.setViewport()` on change. CDPSession invalidated on viewport change to avoid stale layout state.

**Issue 2 — Output size: 127k chars from a single `inspect_styles` call:**
Tested `inspect_styles('.ant-sender', ...)` on the live app. Result: 126,996 characters — too large to return inline, saved to file. Root cause: CSS-in-JS apps like Ant Design inject massive stylesheets. The `matchedRules` array included every rule touching the element, including `*` Tailwind resets (50+ `--tw-*` CSS variables), bare `div` user-agent rules, and Ant Design token blocks. These inflate output regardless of how targeted the selector is — they match everything.

**Fix applied to `inspect-styles.js`:**
- Added `isGenericSelector()` helper — returns true for `*`, `::before`, `::after`, bare HTML element names (no class/id/attribute qualifier)
- Rules where all matching selectors are generic are now skipped entirely
- CSS custom property declarations (`--` prefix) stripped from all rule property lists
- Computed styles (the actually useful data) were correct throughout — the fix targets the matched rules noise only

**Status:** Fixes on disk. MCP server must be restarted to pick them up. After restart: re-run `inspect_styles('.ant-sender')` to confirm size drops from ~127k to manageable.

---

### 2026-03-11 (continued) — All Four Tools Verified Live

**Context:** First live session after `screenshot_element` and `diff_styles` were written. Also first session with Fix #4 (viewport param) and Fix #5 (output size reduction) active.

**Verification sequence:**

**Fix #5 (output size) — PASS**
`inspect_styles('.ant-sender', url)` returned ~2KB of clean, structured data — 4 meaningful matched rules, no generic selector noise, no CSS variable declarations. Down from ~127k chars in the session prior to the fix. The fix is confirmed working exactly as designed.

**`screenshot_element` — PASS (first live test)**
Called on `.ant-sender`. Returned a cropped 374×58px PNG of the sender component — the input field with placeholder "Ask anything or @mention" and the teal send button — inline as base64. Claude sees the actual image. Zero setup required from the user.

**`diff_styles` baseline — PASS**
Called on `.ant-sender` without a prior snapshot. Returned `status: "snapshot_saved"`, captured 47 computed properties. Message correctly instructed the user to make a CSS change and call again.

**`diff_styles` diff — PASS (first live test)**
Temporarily added `border-radius: 0px !important` to `.uni-ai-assist-panel__sender .ant-sender-main` in `UniAIAssistPanel.scss`. HMR applied the change. Called `diff_styles` again — returned exactly 4 changed properties: all four corner radii changed from `8px` → `0px`. Unchanged count: 43. Snapshot cleared automatically. CSS change reverted immediately after.

**Result: all four tools verified. Phase 1 complete.**

| Tool | Status |
|------|--------|
| `get_dom` | ✅ Verified (prior sessions) |
| `inspect_styles` | ✅ Verified (prior sessions) + Fix #5 confirmed working |
| `screenshot_element` | ✅ First live test — PASS |
| `diff_styles` | ✅ First live test — PASS |

**Next:** Phase 1 is done. Candidates for next work: README polish, publish to npm, write the case study, or start Phase 2 (cross-session persistence, smarter filtering, etc.).

---

### 2026-03-11 (continued) — screenshot_element + diff_styles built

**What was built:**

Two new tools added, completing the full Phase 1 tool set:

**`screenshot_element`** (`tools/screenshot-element.js`)
- Captures a cropped PNG screenshot of any element by CSS selector
- Crops to bounding box + configurable padding (default 8px)
- Returns image inline as base64 so Claude sees it directly
- Handles not-found and no-bounding-box (hidden element) cases
- Supports `viewport` parameter (same pattern as other tools)

**`diff_styles`** (`tools/diff-styles.js`)
- Baseline/diff pattern: first call saves a snapshot, second call diffs against it
- Uses `CSS.getComputedStyleForNode` via CDP — same session pattern as `inspect_styles`
- Tracks ~50 properties covering layout, spacing, color, border, typography, and display
- Snapshot cleared after each diff — ready for the next round automatically
- `reset: true` param to discard a snapshot and start fresh
- Returns `status: "no_change"` when nothing changed — explicit signal that CSS didn't apply

Both registered in `index.js`. `screenshot_element` has special handling to return `content: [{type: "image", ...}]` alongside the text metadata so Claude receives the actual image.

**Status:** All four tools on disk. Requires restart. No live test yet — pending first session after restart.

---

### 2026-03-11 (continued) — Fix #6 + #7: Visible window doesn't match viewport

**Context:** Restart after all four Phase 1 tools verified. Fix #6 was already on disk — added `--window-size=1440,900` to Chrome args so the visible browser window would match the 1440×900 viewport.

**Fix #6 result: partially wrong**

The `--window-size` flag was present but the visible Chrome window was still too small. The app was rendering in a narrow frame with lots of white space to the right. Toolbar controls that should appear inline with the Dashboard title (Uniphore dropdown, date range, New button) were wrapping into a separate row.

**Root cause — Retina DPI mismatch:**

On macOS Retina displays, `--window-size` is interpreted in **device pixels**, not CSS pixels. At 2x DPI scaling, `--window-size=1440,900` results in a window that is 720 CSS pixels wide. But `page.setViewport(1440, 900)` sets the viewport in CSS pixels — so the page renders at 1440 CSS px but the visible window only shows 720 CSS px of it. Classic device pixel vs CSS pixel mismatch.

`screenshot_element` was unaffected because puppeteer renders screenshots off-screen at the correct viewport size regardless of physical window dimensions. That's why the MCP screenshots looked correct even though the visible window was wrong.

**Fix #7 applied to `browser.js`:** Added `--force-device-scale-factor=1` to Chrome launch args. This disables HiDPI scaling in Chrome — 1 device pixel = 1 CSS pixel — so `--window-size=1440,900` correctly produces a window with 1440 CSS px of content width.

**Status:** Fix on disk. Requires restart to verify. After restart: open the visible Chrome window and confirm the toolbar controls render inline with the Dashboard title header (not in a separate row below it).

---

### 2026-03-11 (continued) — Fix #8: Switch to headless + ground truth reckoning

**Context:** Resumed after Fix #7 (`--force-device-scale-factor=1`). User confirmed the visible Chrome window still showed layout problems — toolbar stacking on multiple views, page header content stacking. The MCP screenshots continued to look correct.

**The meta-problem surfaced:**

The tool demonstrated the exact problem it was built to solve: a gap between what the tool reported and what actually rendered in the browser. This happened because headed Chrome has two separate "realities":

1. **Puppeteer synthetic viewport** — what `page.setViewport()` sets (1440px). Used for screenshots and CDP queries. Always looked correct.
2. **Physical window viewport** — what the OS actually renders in the visible Chrome window. With `--force-device-scale-factor=1` and `--window-size=1440,900`, the window was 1440 physical pixels but macOS rendered it as 720 CSS points (half the screen). The page CSS rendered at 1440px but the visible window was only 720 CSS points wide — with `overflow: hidden` on the shell containers, the right half of the layout was simply invisible. Elements appeared to stack or truncate because users were only seeing the left 720px of a 1440px layout.

**Why Fix #7 appeared to work (and why it didn't):**

MCP screenshots captured the full 1440px synthetic viewport — they always looked correct regardless of what the visible window showed. Every verification pass confirmed "looks good" against a screenshot that was structurally incapable of showing the problem. The visible Chrome window and the tool's data were reporting two different realities.

**Root cause (fundamental):**

Any tool that launches its own separate browser will always have some gap between what it captures and what the user's real browser shows. This includes Playwright, Cypress, and every other CDP-based tool. The gap can be minimized but not eliminated without connecting to the user's actual browser.

The specific failure here: `Emulation.setDeviceMetricsOverride` (what `page.setViewport()` uses) controls what the CSS engine and CDP queries see. In headed mode, it does NOT reliably control the physical window's rendering. These can diverge — especially on Retina displays.

**Fix #8 applied:** Switched to `headless: true`. Removed `--force-device-scale-factor=1` and `--window-size` args (no longer needed). In headless mode, there is no physical window — the viewport set by `page.setViewport()` is the only viewport. Data, screenshots, and style inspection all reflect exactly what any browser at that viewport would render. No DPI issues, no platform-specific behavior, no synthetic/physical split.

**Tradeoff:** No visible Chrome window. User watches their own browser at localhost:5173 instead. The Puppeteer window was never the point — it was a side effect of headed mode that ended up misleading more than it helped.

**Does this make the tool questionable?**

No. Playwright, Cypress, and every other CDP tool have the same gap between their managed browser and the user's real one. They just don't promise "see what actually renders." We do — so we had a higher bar. Headless meets that bar. The remaining gap (our headless Chrome vs. the user's actual browser) is the same gap every automated tool lives with, and for CSS cascade inspection it's negligible.

**What would eliminate the remaining gap:**

Connecting to the user's existing Chrome tab via `--remote-debugging-port` or a browser extension relay. The tool would then see exactly what the user sees — same viewport, same state, no synthetic anything. Rejected in Phase 1 for zero-setup reasons; worth revisiting as Phase 2 if true ground truth becomes the priority.

**Status:** Fix on disk. Requires restart to verify. After restart: take a screenshot and compare against what the user sees in their own browser — they should now match.

---

### 2026-03-12 — Viewport mismatch confirmed + screenshot_element accuracy debate

**Context:** Resumed after Fix #8 (headless: true). Verified headless Chrome was running by saving a screenshot to Desktop (Terminal.app doesn't render inline images — user was unaware Claude Code could show images; Cursor/iTerm2 both do).

**Finding:** Headless screenshots still don't match the user's browser. Compared MCP screenshot vs. browser side-by-side:
- MCP (1440px headless): Dashboard toolbar (Uniphore, date range, New button) stacks **below** the Dashboard title
- User's browser: toolbar appears **inline in the header row** at top-right

**Root cause confirmed:** Responsive breakpoint difference. The app has a breakpoint that changes header layout somewhere around 1300–1440px. Our headless Chrome at 1440px was on the wrong side of it.

**User's actual viewport:** `1272x970` — confirmed by running `window.innerWidth + 'x' + window.innerHeight` in DevTools console (had to type `allow pasting` first due to Chrome's paste security warning).

**Approach considered and rejected — auto-sync viewport:**
Idea: build a `sync_viewport` tool that spins up a local HTTP server, returns a URL, user opens it once, JS captures viewport and POSTs back. Claude stores it and uses it for all subsequent calls.

**Why rejected (for now):** Bloat. The four core tools (`get_dom`, `inspect_styles`, `diff_styles`, `screenshot_element`) derive their value from CSS cascade data and DOM structure — neither of which depends on viewport. `screenshot_element` is the only tool where viewport matters for visual fidelity, and it's the least important tool. Solving a viewport problem with infrastructure complexity for the least-important tool is the wrong trade-off.

**Open question (parked for later):** The manual step to get the user's viewport (`window.innerWidth + 'x' + window.innerHeight` in the console) is lightweight. If there's a way to capture that without spinning up infrastructure — e.g., a one-liner the user runs once that writes a file the MCP reads — that might be worth it. Needs more thought before building.

**Decision:** Accept that screenshots are approximate. Document it. Ship Phase 1 as-is. Revisit viewport matching only if it becomes a real pain point or if Phase 2 (connect to user's real browser) moves up in priority.

**Current status:** Phase 1 complete. All 4 tools verified. Fix #8 (headless) on disk and active. No code changes this session.

---

## Incident Archive — Inspector as Source of Truth

> Three incidents from a single real session. Not random bugs — a documented pattern.
> Same failure mode: AI targeted wrong element, fix didn't land, inspector revealed the truth.

### The pattern

In every case, Claude assumed which element to target based on reading the source file or component JSX. The assumption was wrong. The fix only became clear once the actual rendered element class name was pasted from the browser inspector.

---

### Incident 1 — Icon color not updating

**Symptom:** A `menu_book` icon in a panel header was gray. The SCSS had been updated to apply a brand color to the header title element. The color still wasn't showing on the icon.

**Claude's assumption:** The CSS variable wasn't resolving. Tried different approaches — hardcoded fallbacks, different class hierarchy.

**What the inspector showed:**
```html
<span class="material-symbols-outlined panel__header-icon" aria-hidden="true">menu_book</span>
```

**Actual problem:** The `.panel__header-icon` class existed in the SCSS but was still set to a muted color. The title wrapper was updated; the icon span itself was not. Two different elements, one explicit color rule each — only one was changed.

**Fix:** Target `.panel__header-icon` specifically.

**Lesson:** An icon inside a title container is a separate element. Updating the container's color rule does not cascade to `<span>` children that have their own explicit color class.

---

### Incident 2 — Added padding, no gap appeared

**Symptom:** Added `padding-top: 10px` to put a gap above a label. No gap visible in the browser.

**Claude's assumption:** The padding was on the correct label class. Updated it. Still no gap.

**What the inspector showed:**
The label div's box dimensions — which revealed that a sibling container directly followed with zero margin, swallowing the visual gap.

**Actual problem:** Claude set padding on the label (correct element) but the value was too small and the adjacent container had no top margin to separate them. The fix needed a larger padding value *and* a left padding to align with sibling text.

**Fix:** `padding: 20px 12px 4px 20px` — larger top gap, left padding matched to sibling text indent.

**Lesson:** Padding/margin gaps in flex layouts depend on which box edge is flush. Read the rendered box model, not the source tree. The inspector's layout box dimensions are ground truth.

---

### Incident 3 — Label misaligned with list items below it

**Symptom:** A "Recents" label was left-padded to 12px but visually misaligned — the list items below it appeared indented further right.

**Claude's assumption:** 12px left padding would match the list container padding.

**What the inspector showed:** The list container had `padding: 0 8px 12px` — but the component library's list items had internal left padding of approximately 12px on top of that. Total visual indent ≈ 20px.

**Fix:** Set `padding-left: 20px` on the label to align its text with the list item text, not the list item box edge.

**Lesson:** Component library items have internal layout that isn't visible from reading the wrapper's CSS. Always measure from the rendered text position, not the box edge.

---

### Rule

> Before writing CSS that targets a specific element, always verify the class name from the rendered DOM — not from the JSX source or SCSS file.
>
> If a style change isn't showing: the first question is "am I targeting the right element?" — not "is the CSS var resolving?" or "is there a specificity problem?".
>
> The inspector's element class string is the only reliable source of truth. Everything else is inference.
