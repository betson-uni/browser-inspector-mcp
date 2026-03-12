# Browser CSS Inspector MCP — Phase 1 Spec

> Execute from here. This is the build document.
> Decisions are final unless explicitly revisited and dated.
> Strategy and philosophy live in thinking.md. Session log in sessions.md.

---

## What Phase 1 Is

A working MCP server, installed locally, that gives Claude two tools:

1. `get_dom(selector)` — return the rendered outerHTML of an element
2. `inspect_styles(selector)` — return the full CSS cascade for an element

Tested against the exact failure mode that created this idea. Used in a real CSS debugging session. If it works — it solves the problem. If it doesn't — we learn why and adjust.

Nothing else. No browser extension. No diff tool. No npm publish. No README for strangers. Just: does this work?

---

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Connection model | Launch managed Chrome via puppeteer-core | Zero setup for user. No `--remote-debugging-port` flag. A tool that requires prerequisites is a tool people forget to set up. |
| CDP library | `chrome-remote-interface` via puppeteer CDP session | Actively maintained. Full access to CSS domain. Puppeteer handles browser lifecycle. |
| Phase 1 scope | `get_dom` + `inspect_styles` only | Solves Problems 1 and 3 directly. Problem 2 (`diff_styles`) is Phase 2. |
| Language | Node.js | Native for MCP servers. CDP libraries mature. No build step needed. |
| Output format | Structured JSON shaped for LLM consumption | Not raw CDP response. Filtered and labelled so Claude can reason about it without noise. |

---

## Tool Definitions

### `get_dom(selector)`

**When Claude should use it:** Before writing CSS targeting any element. Always. Before the first line.

**What it returns:**
```json
{
  "selector": ".dropdown-menu-item",
  "found": true,
  "outerHTML": "<li class=\"ant-dropdown-menu-item ...\">...</li>",
  "tagName": "LI",
  "classList": ["ant-dropdown-menu-item", "ant-dropdown-menu-item-only-child"],
  "childCount": 1
}
```

**Tool description (what Claude reads):**
> Returns the rendered HTML of an element in the live browser — actual class names, DOM structure, and attributes as they exist at runtime. Call this before writing any CSS that targets a specific element. The class names in source code and JSX may differ from what the browser actually renders, especially with component libraries. This is the ground truth.

---

### `inspect_styles(selector)`

**When Claude should use it:** When a style change isn't showing up as expected. Or to verify a computed value before assuming it needs changing.

**What it returns:**
```json
{
  "selector": ".ant-dropdown-menu-item",
  "found": true,
  "computed": {
    "display": "flex",
    "color": "rgba(0, 0, 0, 0.88)",
    "font-weight": "400",
    "padding": "5px 12px"
  },
  "matchedRules": [
    {
      "selector": ".ant-dropdown-menu-item",
      "source": "injected stylesheet (antd CSS-in-JS)",
      "properties": [
        { "name": "display", "value": "flex", "active": true },
        { "name": "padding", "value": "5px 12px", "active": true }
      ],
      "specificity": "0,1,0"
    },
    {
      "selector": ".dropdown-menu .ant-dropdown-menu-item",
      "source": "src/components/dropdown.scss line 42",
      "properties": [
        { "name": "display", "value": "block", "active": false, "overriddenBy": ".ant-dropdown-menu-item" }
      ],
      "specificity": "0,2,0"
    }
  ]
}
```

**Tool description (what Claude reads):**
> Returns the full CSS cascade for an element: computed property values plus every CSS rule that matched the element, where each rule came from (stylesheet name and line number), and whether each property is active or overridden. Use this when a CSS change isn't showing up, when you need to understand which rule is winning a specificity conflict, or to verify a computed value before assuming it needs to change.

---

## Architecture

```
Claude Code (MCP client)
    ↓ calls tool
MCP Server (Node.js, stdio transport)
    ↓ puppeteer-core launches/connects to Chrome
Chrome (managed instance, headless or visible)
    ↓ CDP session
CSS.getMatchedStylesForNode / DOM.getOuterHTML
    ↑ structured JSON response
MCP Server formats and returns to Claude
```

**Browser lifecycle:** Server launches Chrome on first tool call, keeps it open for the session, closes on server shutdown. One browser instance per MCP session. Navigate to the dev server URL on connect.

---

## File Structure

```
browser-inspector-mcp/
├── package.json
├── index.js          ← MCP server entry point
├── browser.js        ← Chrome launch + CDP session management
├── tools/
│   ├── get-dom.js
│   └── inspect-styles.js
└── README.md         ← install + usage, for personal use only in Phase 1
```

---

## Phase 1 Success Criteria

- [ ] MCP server installs and runs locally
- [ ] Claude Code picks up both tools via MCP config
- [ ] `get_dom('.ant-dropdown-menu-item')` returns real class names from a running dev server
- [ ] `inspect_styles('.ant-dropdown-menu-item')` returns cascade with antd CSS-in-JS rules visible and sourced
- [ ] Claude uses `get_dom` before writing CSS in a real session without being explicitly told to
- [ ] At least one real CSS bug fixed faster than it would have been without the tool

---

## Not in Phase 1

- `screenshot_element` — Phase 2
- `diff_styles` — Phase 2
- Browser extension — Phase 2
- npm publish — Phase 3
- Designer-facing docs — Phase 3
- Error handling beyond basic failures — Phase 2
- Multiple browser support (Firefox, Safari) — never, or much later

---

## Known Limitations

### Viewport is fixed at launch

The browser launches once and holds a single viewport for the session. Current config: `1440×900` (overriding puppeteer's legacy default of `800×600`).

This means breakpoint-specific styles — anything inside a `@media` query that only applies below a certain width — won't be visible unless the viewport matches. For the current use case (desktop app, dev runtime), this is fine.

**If viewport control is needed (Phase 2 candidate):**

Two options were considered:
1. `viewport` parameter on the tools — pass `{width, height}` per call, `page.setViewport()` before inspecting
2. Named presets — `viewport: "mobile"` / `"tablet"` / `"desktop"` — more ergonomic, same mechanism

Neither is worth adding until there's a concrete need. The tool is a CSS cascade inspector, not a responsive testing tool. The right scope is: inspect the element you're looking at, at the viewport you're building for. If that changes, add `viewport` as an optional parameter then.

---

## Phase 2 — Confirmed Direction (2026-03-11)

### Dual connection mode

**The problem:** Any tool that launches its own separate browser has a gap between what it captures and what the user's real browser shows. In headed mode this gap manifested badly (two separate viewports, tool data didn't match visible rendering). Switching to headless minimized the gap — but didn't eliminate it. The user's actual browser is still a separate thing from the tool's managed Chrome.

**The confirmed plan:** Ship both modes.

**Mode 1 (current):** Managed headless Chrome. Zero setup. Consistent viewport. Good for most use cases.

**Mode 2 (Phase 2):** Connect to user's existing browser. True ground truth — the tool sees exactly what the user sees, at the same viewport, same state, no synthetic anything.

Implementation options to evaluate:
1. `--remote-debugging-port` — user launches Chrome with a flag, tool connects via CDP. Simple but requires user action each time.
2. Browser extension relay — extension lives in the user's real browser tab, forwards CDP data to the MCP server. One-time install, then always-on. No flag required. This is the stronger long-term model.

The extension path is worth designing properly — not bolting on. `devtoolcss/chrome-inspector-mcp` proved the technical concept exists; the gap is execution, polish, and documentation.
