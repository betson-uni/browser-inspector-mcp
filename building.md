# How browser-inspector-mcp was built

> A designer's account of building a developer tool — the problem, the research, the decisions, and the thinking behind them.

---

## Where this came from

This tool came out of a real debugging moment, not a planned project.

I was working on a React component library, trying to fix a dropdown menu — making menu items use `display: flex` so icons and text aligned correctly. The fix wasn't working. Multiple rounds of editing, committing, checking the browser. Still wrong.

Eventually I opened DevTools, found the actual element, and pasted the HTML back into the chat. The problem was immediately obvious:

```html
<ul class="ant-dropdown-menu ...">
  <li class="ant-dropdown-menu-item ...">
    <span class="ant-dropdown-menu-title-content">
      <div class="ant-dropdown-menu-item-container">
```

The AI had been targeting `.ant-menu-item`. The browser rendered `.ant-dropdown-menu-item`. The same Ant Design `<Menu>` component generates different class names depending on context — standalone vs inside a `<Dropdown>`. There was no way to know without looking at the live DOM.

That manual copy-paste — open DevTools, find the element, copy the HTML, paste it back — was the gap. And the question that followed naturally was: *is there already a tool that closes this gap automatically?*

---

## What already existed

Research conducted before writing a line of code.

**Google's `chrome-devtools-mcp`** (official Chrome DevTools team, late 2025) does not implement `CSS.getMatchedStylesForNode` — the CDP method that returns the full style cascade. GitHub Issue #86 is an open feature request filed immediately after launch. Google's own DevTools team acknowledged the gap and hadn't shipped it.

**`devtoolcss/chrome-inspector-mcp`** — the closest existing implementation. Wraps `CSS.getMatchedStylesForNode` via a Chrome extension relay. Small project, low adoption, no documentation. The technical proof of concept existed. The product didn't.

**Playwright MCP** — uses the accessibility tree. Known open bug: DOM snapshots don't collect styles. No cascade data, no specificity, no source tracing.

**Browser extension tools** (Web to MCP, SightRelay, ContextBox) — capture computed styles in snapshot form. Faster than pasting from DevTools, but structurally the same limitation: no cascade, no specificity chain, no source.

The gap was real and confirmed. The strategic question shifted from *should this exist?* to *what's the version that can't be made redundant?* Answer: opinionated, scoped to the CSS debugging workflow, documented from the designer's angle — not the engineer's.

---

## Three ways the problem shows up

During research I separated what felt like one problem into three distinct failure modes. Each one has a name.

---

**Problem 1 — Reading the recipe, not the dish**

A tailor studies the original design pattern for a suit — the flat paper template. They know every seam. But the suit in front of them was made by someone else who made modifications. The pattern is not what was built.

That's AI reading CSS source files. It's reading the original pattern. The browser rendered what the component library built at runtime, and that library made its own modifications. The AI keeps altering the wrong seam.

*The inspector is the fitting room. You check what was actually built before you touch it.*

---

**Problem 2 — Adjusting the aerial blind**

You're in the backyard adjusting a TV aerial. Someone inside is watching the picture. Every time you move it, you shout "better or worse?" and wait. Each adjustment is a round trip.

That's the push-check-push cycle. The AI makes a change. You walk to the browser. You look. You type what you saw. Each loop is a round trip with no direct connection between the person holding the aerial and the person watching the screen.

The absence isn't intelligence — the AI is making reasonable guesses. The absence is *a wire between the action and the result.*

---

**Problem 3 — Treating the wrong patient**

A doctor sees someone who looks pale and tired. Without examining them, they assume iron deficiency and prescribe accordingly. Six weeks later, nothing's changed. It was thyroid all along.

The AI looks at text that appears bold in a screenshot. It assumes `font-weight` is set high. It tries to override it. But the value was 400 — the text just rendered that way at that size. The AI spent the session solving a problem that didn't exist.

*Inspect before you prescribe. The computed value is the examination.*

---

**The pattern underneath all three**

Construction has the as-built drawing. Medicine has the examination before prescription. Tailoring has the fitting. Every robust system that deals with the gap between *what you think is true* and *what is actually true* has invented the same mechanism: a verification step before action, not after.

---

## What I decided to build

One tool with four actions, not four separate tools. The reasoning:

The people most likely to benefit from this aren't engineers who live in terminals — they're designers and non-techies using AI coding tools. They shouldn't need to know which specific tool to call. They should describe what they're working on and have the right thing happen. A single `browser_inspect` entry point with an `action` parameter means Claude picks the right action based on context. The user just talks about their problem.

A `help` action was added for the same reason — if someone calls it without knowing what to do, they get plain-English guidance and example prompts, not an error.

**The four actions:**

| Action | What it does |
|--------|-------------|
| `dom` | Rendered HTML — actual runtime class names and DOM structure |
| `styles` | Full CSS cascade: every matched rule, where it came from, which rule won |
| `screenshot` | Cropped visual snapshot of any element, returned inline |
| `diff` | Computed styles before and after a CSS change — confirms a fix landed |

---

## Key decisions

**Zero setup.** The browser launches automatically on first call via Puppeteer. No `--remote-debugging-port` flag, no Chrome configuration. A tool that requires prerequisites is a tool people forget to set up.

**Headless Chrome.** Started with a visible browser window — seemed more intuitive. Hit a problem: on Retina displays, the visible Chrome window and the tool's synthetic viewport were two separate realities. The tool's screenshots looked correct. The visible window showed layout problems. The tool was demonstrating the exact problem it was built to solve. Switched to headless: one authoritative viewport, no platform-specific split.

**Structured output, not raw CDP.** The raw CDP response is enormous and full of noise — CSS reset rules, Tailwind variable declarations, generic element rules that match everything. Filtered to what's actually useful: rules with specific selectors, no CSS custom property declarations, clean source attribution. The output went from ~127k characters to ~2k on a real component.

**Node.js.** Native for MCP servers. No build step. CDP libraries mature. Straightforward.

---

## Architecture

```
AI tool (Claude Code, Cursor, etc.)
    ↓ calls browser_inspect
MCP Server (Node.js, stdio transport)
    ↓ Puppeteer launches/connects to Chrome
Chrome (managed headless instance)
    ↓ CDP session
CSS.getMatchedStylesForNode / DOM.querySelector / Page.captureScreenshot
    ↑ structured JSON (or image) response
MCP Server formats and returns to AI
```

One browser, one page, one CDP session per MCP server instance. Browser stays open for the session, closes on server shutdown.

---

## What I didn't build — and why

**Viewport matching.** The tool's headless Chrome at 1440px doesn't match every user's actual browser viewport. This matters for screenshots; it doesn't affect CSS cascade data. Building a sync mechanism (a local server, a console one-liner that writes a file) adds infrastructure complexity for the least-important tool. Accepted as a known limitation, documented it.

**Live style injection.** The obvious next step: `set_styles(selector, properties)` — write directly to the live browser via CDP, see the change instantly, no file save or hot reload. Not built yet because the read side needed to be solid and trusted first. The architecture already supports it.

**Browser extension handoff.** Drag a rectangle over any element in your real browser, capture the visual + DOM + styles, send directly to the AI session. One gesture replaces the manual copy-paste entirely. Phase 2 — depends on the MCP server existing first.

**Multiple selectors, batch inspection.** Came up. Rejected. The single-element inspection workflow is the right scope for Phase 1. Complexity later if there's demand.

---

## The ground truth problem

There's a known gap in any tool that launches its own separate browser: what it captures isn't exactly what the user's real browser shows. Playwright has this. Cypress has this. Every CDP-based tool has this.

The specific failure: our headless Chrome at 1440px can land on the wrong side of a responsive breakpoint compared to the user's actual browser. For CSS cascade inspection this barely matters — matched rules, specificity, and source attribution are accurate at any viewport. For screenshots it means the visual is approximate, not exact.

The true ground truth approach is connecting to the user's *existing* browser tab — same viewport, same state, no synthetic anything. This was rejected for Phase 1 because it requires the user to launch Chrome with a debug flag or install an extension. Zero setup was the priority. Revisiting this in Phase 2 as an optional mode.

---

## What's next

- **Phase 2 — connect to user's real browser.** Two options: `--remote-debugging-port` (user launches Chrome with a flag) or a browser extension relay (one-time install, then always-on). The extension model is the stronger long-term play.
- **Live style injection** — AI writes directly to the browser, you see the change instantly, source file only gets touched once the result is confirmed.
- **Browser extension handoff** — drag-to-select any element in your browser, send the visual + DOM + styles to your AI session in one gesture.

---

## The bigger thought

The design double diamond — discover → define → develop → deliver — was built for a world where *building* was the expensive bottleneck. Research took weeks. Prototyping took weeks. Shipping took months.

In the AI era, building is nearly free. The bottleneck flipped. It's now *thinking clearly* that's scarce. Anyone can ship. Almost nobody knows what to ship, or why.

The diamond doesn't get compressed. It gets **inverted in value** — the diverge and discover phases matter more than ever, and the build phase barely needs a framework. The tools handle build. Humans handle think.

That reframe changed how I approached this: more time on the problem before touching code. Research before spec. Analogies before architecture. The three failure modes were named before a single tool was defined. The tool description — the single line an AI reads to decide when to call a tool — was treated as a design decision, not a documentation task. If it's written well, the AI calls `browser_inspect` before writing CSS without being told to. If it's vague, it waits to be asked. The interface creates the habit.

That's the kind of thing a designer notices that an engineer might not.

---

## Who it's for

Designers and design system contributors who use AI coding tools but don't live in IDEs. People who think visually, verify visually, and find "paste the HTML from DevTools" to be a jarring context switch that breaks their flow.

Frontend engineers who want their AI pair programmer to close the loop on its own — inspect, change, verify — without needing to be walked through what the browser is actually rendering.

Anyone working with component libraries where runtime class names don't match source. Ant Design, Material UI, Radix, Shadcn — anywhere the browser builds a different structure than what's in the JSX.

> "That's me — and I hope there are other designers and non-techies out there who find it useful."
