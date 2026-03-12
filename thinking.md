# Browser CSS Inspector MCP — Thinking

> The "why and what" doc. Strategy, problem definition, analogies, ideas, philosophy.
> Safe to share with people to explain the project.
> Updated as thinking evolves — not a spec, not a log.

---

## 1. The Problem — Why This Idea Exists

This idea came out of a real, frustrating debugging moment during design system work on a React component library. The workflow looked like this:

1. Claude (in Claude Code CLI) edits a CSS/SCSS file to fix a component styling issue
2. The change is committed and pushed to a PR branch
3. The human opens their browser, checks the result — still wrong
4. Claude has no idea why — wrong selector? Specificity war? Wrong class name entirely?
5. Human opens browser DevTools, inspects manually, pastes the raw HTML back into the chat
6. Claude figures out the actual problem and tries again

**The specific incident that triggered this:**

We were trying to fix a dropdown menu component — making menu items have `display: flex` so icons and text aligned properly. Claude was targeting `.ant-menu-item` in SCSS. The fix wasn't working. After multiple push-check-fail cycles, the human finally pasted the actual DOM from DevTools:

```html
<ul class="ant-dropdown-menu ...">
  <li class="ant-dropdown-menu-item ...">
    <span class="ant-dropdown-menu-title-content">
      <div class="ant-dropdown-menu-item-container">
        <span class="material-symbols-outlined" style="font-size: 24px;">person</span>
        Manage Roles
      </div>
    </span>
  </li>
</ul>
```

Immediately obvious: the class is `ant-dropdown-menu-item`, not `ant-menu-item`. The same Ant Design `Menu` component renders *different class names* depending on whether it's standalone or inside a `Dropdown`. Claude had no way to know this without seeing the live DOM.

**The core gap:** Claude can read source files, write SCSS, and reason about CSS — but cannot see the rendered output, the computed styles, or the actual class names that land in the browser. Everything is guesswork until a human bridges the gap manually.

**Secondary discovery during the same session:**

We also couldn't confirm whether font-weight was actually bold (antd CSS-in-JS override?) or just looked that way in a screenshot. The human had to go to DevTools → Computed tab → check the `font-weight` value (it was 400 — not bold at all). Without that, Claude would have kept chasing a non-problem.

---

## 2. What Exists Today

### The landscape as of early 2026

Research conducted 2026-03-11. Full findings in sessions.md.

**Google's `chrome-devtools-mcp`** (official Chrome DevTools team, September 2025) — does not implement `CSS.getMatchedStylesForNode`. GitHub Issue #86 is an open feature request filed immediately after launch. The most authoritative DevTools team in the world acknowledged the gap and hasn't shipped it.

**`devtoolcss/chrome-inspector-mcp`** — the closest existing implementation. Wraps `CSS.getMatchedStylesForNode` via a Chrome extension relay. Small project, low adoption, no documentation polish. The technical proof of concept exists. The product doesn't.

**Playwright MCP** — uses the accessibility tree, not CSS. Known open bug: DOM snapshots do not collect styles. No matched rules, no specificity, no cascade data.

**Browser extension tools** (Web to MCP, SightRelay, ContextBox) — capture computed styles in snapshot form. Faster than pasting from DevTools, but structurally the same problem: no cascade, no specificity chain, no source tracing.

**`chrome-remote-interface`** (Node.js CDP wrapper) — actively maintained, good foundation for Phase 1.

### The gap Playwright MCP doesn't fill

Playwright gives you raw browser automation. What's needed is *style source tracing* — not just *what* a CSS property computes to, but *which rule is winning and why*:
- Which stylesheet is the rule coming from?
- What is the specificity of the winning rule vs the losing ones?
- Is this coming from CSS-in-JS injected at runtime, or from our own stylesheet?
- Is our class even reaching the element in the first place?

Chrome DevTools' "Styles" panel shows all of this. `CSS.getMatchedStylesForNode` is the CDP method that returns it. Nothing in the MCP ecosystem exposes this in a structured, AI-usable way today.

---

## 3. The Problem in Plain Language — Analogies

> Useful for posts, README intros, and getting non-technical people to understand what this solves.
> These three analogies map to three structural failure modes documented with real incidents in sessions.md.

---

### Problem 1 — Reading the recipe, not the dish

Imagine a tailor who studies the original design pattern for a suit — the flat paper template. They know every seam. But the suit hanging in front of them was made by a different tailor three years ago, and that tailor made modifications. The pattern is not what was built.

That's what happens when AI reads CSS source files. It's reading the original pattern. The browser renders what the component library built at runtime — and that library made its own modifications. The class name in the pattern became something different in the actual garment. The AI keeps altering the wrong seam.

**The inspector is the fitting room.** You check what was actually built before you touch it.

---

### Problem 2 — Adjusting the aerial blind

You're in the backyard adjusting a TV aerial. Someone inside is watching the picture. Every time you move it, you shout "better or worse?" and wait. Each adjustment is a round trip: outside to move it, inside to check, outside again.

That's the push-check-push cycle. The AI makes a change. You walk to the browser. You look. You walk back. You type what you saw. Each loop is a round trip with no direct connection between the person holding the aerial and the person watching the screen.

The absence isn't intelligence — the AI is making reasonable guesses. The absence is **a wire between the action and the result.** Right now that wire is you, walking back and forth.

---

### Problem 3 — Treating the wrong patient

A doctor sees someone who looks pale and tired. Without testing, they assume it's iron deficiency and prescribe accordingly. Six weeks later the patient is the same. It was thyroid all along. The symptom pointed one way; the actual cause was elsewhere.

The AI looks at text that appears bold in a screenshot. It assumes `font-weight` is set high. It tries to override it. But the value was 400 all along — the text just rendered that way at that size. The AI spent the session solving a problem that didn't exist.

---

### The pattern underneath all three

Construction has the as-built drawing. Medicine has the examination before prescription. Tailoring has the fitting. Aviation has instruments. Cooking has tasting as you go.

Every robust system that deals with the gap between *what you think is true* and *what is actually true* has invented the same mechanism: **a verification step before action, not after.**

The fitting happens before the scissors. The examination happens before the prescription. The inspector gets called before Claude writes a line of CSS.

That's not just a data problem. That's a **habit built into the interface** — and the tool description (the single line Claude reads to decide when to use a tool) is the most important thing to write in Phase 1.

> The tool description drives automatic behavior. If it's written well, Claude calls `get_dom` before writing CSS without being told to. If it's vague, Claude waits to be asked. The interface creates the habit. This is a design decision disguised as a documentation task — exactly the kind of thing a designer notices that an engineer might not.

---

## 4. The Idea — Component CSS Inspector MCP

A purpose-built MCP server for **CSS/component debugging in a live dev environment**.

### Core workflow it enables
```
Developer opens a component in the browser
  → Claude calls get_dom(selector) before writing any CSS
  → Gets back: the rendered class names and DOM structure
  → Claude writes CSS targeting the right element
  → Claude calls inspect_styles(selector) if the fix isn't showing
  → Gets back: full cascade — computed values + every matched rule with source and specificity
  → Claude fixes the right thing the first time
  → No human DevTools required
```

### Tools it exposes to Claude

| Tool | What it does | When Claude should use it |
|------|-------------|--------------------------|
| `get_dom(selector)` | Rendered outerHTML — actual class names, structure, attributes | **Before writing CSS** for any element. Always. |
| `inspect_styles(selector)` | Full cascade: computed values + matched rules with source file + specificity chain | When a style change isn't showing up, or to verify a computed value before assuming it needs changing |
| `screenshot_element(selector)` | Visual crop of just that component | Before/after confirmation |
| `diff_styles(selector)` | Computed styles before and after a code change | Phase 2 |

### What makes it different from Playwright MCP

- Designed for CSS debugging, not general browser automation
- Returns structured data an LLM can reason about — not raw HTML strings
- Exposes the full specificity chain so Claude understands *why* a rule wins or loses
- Minimal surface area — does one thing extremely well
- Documented from the designer's angle, not the engineer's

---

## 5. Phase 2 Decisions — 2026-03-11

### screenshot_element — token cost vs manual tradeoff

The obvious question when adding a screenshot tool: is this just automating something you can already do manually (Cmd+Shift+4 + paste)?

**Token cost:** Claude prices images by ~512×512 tile. A typical UI component is 1–2 tiles = ~1,600–3,200 tokens. Meaningful but not wasteful.

**The honest answer:** For pure visual confirmation, a manual screenshot and `screenshot_element` return the same data at the same token cost. The difference is workflow — the tool crops exactly to the element, stays within the session, and can be called autonomously mid-debug without breaking the loop.

**Why we built it anyway:** The bigger value isn't the screenshot itself — it's that it sets up the read-write future (see section 6b). You need screenshot as a feedback mechanism before live style injection makes sense. And the marginal effort to build it was low.

**`diff_styles` is the more important Phase 2 tool.** Screenshot answers "does it look right?" — which requires human judgement. `diff_styles` answers "did the CSS change actually apply?" — which is objective and something Claude can reason about without human input. That's the one that actually closes the feedback loop autonomously.

---

## 6. Adjacent Ideas — Captured, Not Committed

> Diverging before converging. These came up naturally — not committing to any of them yet.

### 6a. Browser-to-Claude Visual Handoff (Select + Send)

A lightweight browser extension: drag a rectangle over a UI element, and it captures the visual + DOM + computed styles and sends everything directly to the Claude Code session. No screenshot file, no drag-and-drop, no manual paste.

The key difference from existing tools: the screenshot arrives *with the class names and CSS underneath it already attached*. One gesture replaces two separate manual steps.

**Trigger options:** extension button + drag, keyboard shortcut overlay, right-click "Send to Claude."

**Technical path:** Chrome extension overlay captures coordinates → fires to local MCP server via WebSocket → MCP server calls CDP `Page.captureScreenshot` with clip rect + `CSS.getMatchedStylesForNode` → forwards bundle to Claude.

**Status:** Phase 2. Depends on the MCP server existing first.

### 6b. Live Side-by-Side Editing (Read → Read-Write)

The current tools are **read-only** — they observe but don't touch. The natural next phase is adding write tools:

- `set_styles(selector, { color: 'red', fontWeight: 600 })` — inject CSS directly into the live page via CDP (`CSS.setStyleTexts` or `page.evaluate`). You see the change instantly, no file save or hot reload needed.
- `click(selector)` — interact with the page
- `type(selector, text)` — fill inputs

With those, the loop becomes:
1. Claude inspects the element (`get_dom`, `inspect_styles`)
2. Claude injects a style change directly into the browser — visible immediately, side by side
3. Claude screenshots to confirm visually
4. If it looks right, Claude writes the permanent change to the source file

That's the AI equivalent of tweaking values in DevTools in real time — except Claude is holding the screwdriver, not you. No push-check-push cycle at all. The human watches, approves, and the source file only gets touched once the result is confirmed.

**Why it's not in scope yet:** The read side isn't fully tested in the wild. But the architecture already supports it — CDP has full write access to styles, the browser is already managed. Adding write tools is straightforward once the read side is solid and trusted.

**This could extend beyond CSS** to a general-purpose live UI coding tool — any website, any framework, side by side in real time.

---

### 6c. Visual Before/After for Pull Requests

Automatically generate a visual diff card for any PR touching UI code: screenshot before the change, screenshot after, one plain-English sentence describing what changed. Appended to the PR description.

**The hard problem:** where does "before" come from? Best option: auto-snapshot on PR open from the base branch, no external service required.

**Why this matters:** PR diffs are exclusionary by default. A visual summary is inclusive by design — understandable by designers, PMs, and future engineers who weren't there.

**Status:** Separate product. May use the inspector under the hood. Not part of this tool.

---

## 6. Strategy — Build and Launch

### Phase 1 — Proof of concept, personal use
- Node.js + `chrome-remote-interface` directly on CDP
- Two tools: `get_dom(selector)` and `inspect_styles(selector)`
- Launch managed Chrome via puppeteer-core (zero setup — no `--remote-debugging-port` flag required)
- Package as MCP server, wire into Claude Code locally
- Test against the exact failure mode that created this idea

### Phase 2 — Solidify the core
- ~~Add `screenshot_element`, `diff_styles`~~ — done 2026-03-11
- Add live style injection: `set_styles(selector, properties)` — write directly to browser via CDP, no file save needed
- Handle edge cases: portals (e.g. Dropdown components), shadow DOM, iframes
- Add browser extension for visual selection handoff (6a above)
- Docs written for designers first

### Phase 3 — Open source and community
- Publish to npm as `@browserinspector/mcp` (name TBD)
- Submit to MCP server registry / Anthropic's directory
- README written for designers first, not engineers
- GitHub Discussions open from day one

---

## 7. Maintenance and Open Source Philosophy

**The goal isn't just to build it — it's to maintain it well enough that others trust it.**

- Changelog-driven — every release has a human-readable changelog
- Semver strictly — no surprise breaking changes
- Contributions welcome from designers who don't live in IDEs
- Tests that verify actual CSS inspection output, not just unit tests
- CI that runs against real browser instances

**Growth:**
- The problem is universal — any CSS-heavy project with an AI coding workflow hits this gap
- Designers using Cursor, Claude Code, Windsurf all hit this
- Design system teams are a natural early audience
- The origin story is authentic and the blog post practically writes itself

---

## 8. The Audience

**Primary:** Designers and design system contributors who use AI coding tools but don't live in IDEs. People who think visually, verify visually, and find "paste the HTML from DevTools" to be a jarring context switch.

**Secondary:** Frontend engineers who want their AI pair programmer to close the loop automatically — no manual verification step.

> "That's me and I hope there are other designers, non-techies out there."
> — The person who had this idea, while debugging a dropdown menu at 1am

---

## 9. The Bigger Thought — Design Process in the AI Era

The double diamond (discover → define → develop → deliver) was designed for a world where *building* was the expensive bottleneck. Research took weeks, prototyping took weeks, shipping took months.

In the AI era, building is nearly free. The bottleneck flipped — it's now *thinking clearly* that's scarce. Anyone can ship. Almost nobody knows what to ship or why.

The diamond doesn't get compressed. It gets **inverted in value** — the diverge/discover phases matter more than ever, and the build phase almost doesn't need a framework at all. The tools handle build. Humans handle think.

**The reframe:** Design process in the AI era isn't about managing the cost of building. It's about managing the clarity of thinking. The diamond shape stays the same. What goes inside each phase changes completely.

**Build philosophy for this project:**

> Spend 90% sharpening the axe. Spending more time with the problem is usually revealing. Most solutions would be stronger if the problem was understood more deeply first. But this is not permission to plan forever. The goal is to build something. Small, complete in itself, carefully crafted however small it is. Ship it. Get reactions from real people. Then build further.
>
> Ruthless prioritisation is the mechanism. Build the simplest thing that is complete in itself. Form follows function — it does what it's supposed to do, it solves the problem it's supposed to solve. Beautify later.

---

## 10. This as a Case Study

Most portfolios show: problem → solution → result. Clean, polished, retrospective.

What's rare — and what people actually want to read — is the messy middle: the wrong turns, the "wait I just had a better idea" moments, the thing that almost got built instead.

The session log in sessions.md *is* that story, captured live. By the time v1 ships, the case study writes itself.

**Why this matters beyond portfolio:** It's a model for how designers can engage with the AI-assisted building process without losing their design voice. Not "I used AI to build a thing" — but "here is how I thought, how I directed, how I iterated, and here is what emerged." The thinking is the work. The tool is the artifact.

> "This could be my design case study, makes it much more fun than building the damn portfolio."
> — the exact right instinct
