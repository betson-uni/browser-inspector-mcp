# Browser CSS Inspector MCP

> Start here. This is the index. Everything else lives in the files below.

---

## Files

| File | Purpose |
|------|---------|
| [thinking.md](./thinking.md) | Why this exists. The problem, the analogies, the idea, adjacent ideas, strategy, audience, philosophy. The "why and what" doc — share this with people to explain the project. |
| [sessions.md](./sessions.md) | Running session log + real-world incident archive. Grows over time. Source material for the case study. |
| [spec.md](./spec.md) | Phase 1 technical spec. Build decisions, tool definitions, connection model. Execute from here. |

**Case study:** Written after v1 ships. Lives in `~/Dev Projects/Uniphore/_notes/browser-inspector-mcp.md` alongside the other project case studies. Not started until there's something real to write about.

---

## What this is

A purpose-built MCP server that gives AI coding tools (Claude Code, Cursor, etc.) access to the same CSS information a human sees in browser DevTools. Specifically: the full CSS cascade for any element — which rules matched, which rule won, where each rule came from, and why.

The core problem: AI reads source files. Browsers render something different. Every modern component library (Ant Design, Material UI, Radix, Shadcn) generates class names at runtime that don't match what's in the JSX or SCSS source. AI writes CSS for the pattern. The garment was built differently.

**The inspector is the fitting room.**

---

## Status

| Phase | Status |
|-------|--------|
| Problem validated | Done — 5 documented real incidents across 2 sessions |
| Landscape research | Done — gap confirmed, one low-adoption partial solution exists |
| Philosophy + approach | Done — see sessions.md 2026-03-11 |
| Phase 1 spec | In progress |
| Phase 1 build | Done — `get_dom` verified, `inspect_styles` bug fixed, needs restart to confirm |
| v1 shipped | Not started |
| Case study | Not started |

---

## The one-line pitch

> Before your AI writes CSS, let it see what's actually in the browser. Same data a human gets from DevTools. Zero manual copy-paste.
