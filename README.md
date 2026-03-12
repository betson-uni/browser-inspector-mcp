# browser-inspector-mcp

**Gives your AI coding tool the same CSS visibility you have in browser DevTools.**

Before your AI writes CSS, let it see what's actually in the browser — the real rendered class names, the full cascade of rules, what's winning and why. Same data a human gets from DevTools. Zero manual copy-paste.

---

<details>
<summary><strong>TLDR — I know what I'm doing, just show me the setup</strong></summary>

<br>

**Requirements:** Node.js 18+, an MCP-compatible AI tool (Claude Code, Cursor, Windsurf, Cline, etc.), a running local dev server.

**Config** (add to your AI tool's MCP config file):

```json
{
  "mcpServers": {
    "browser-inspector": {
      "command": "npx",
      "args": ["-y", "browser-inspector-mcp"]
    }
  }
}
```

Config file locations:
- Claude Code: `~/.claude.json`
- Cursor: `~/.cursor/mcp.json` or `.cursor/mcp.json`
- Windsurf: `~/.codeium/windsurf/mcp_config.json`
- Others: wherever your tool reads MCP server config

Restart your AI tool. First call, tell your AI what URL your dev server is running on — the browser session persists for the rest of the conversation.

One tool, four actions: `browser_inspect` with `action: "dom"` (rendered DOM), `"styles"` (full CSS cascade), `"diff"` (before/after verification), `"screenshot"` (visual snapshot). Or just describe what you need — Claude picks the right action.

On first use, Puppeteer downloads Chromium (~170MB).

</details>

<details>
<summary><strong>Teach me — I'm new to this, walk me through everything</strong></summary>

<br>

### Before you start — what you need

This tool connects two things you need to already have set up: an AI coding tool and a web project you're actively working on. Here's what each of those means and how to get them.

---

#### 1. Node.js (the engine that runs this tool)

Node.js is a program that lets your computer run JavaScript outside of a browser. npm and npx — the commands used to install and run this tool — come included with Node.js.

**Do you already have it?** Open Terminal (Mac) or Command Prompt (Windows) and type:
```
node --version
```
If you see a version number like `v20.11.0`, you're good. If you get an error, you need to install it.

**Install it:** Download from [nodejs.org](https://nodejs.org) — get the LTS version (the one labeled "Recommended for most users"). Run the installer. That's it.

---

#### 2. An AI coding tool

This is the tool you type into when asking AI to write or fix code. This MCP server works with any of the following — you only need one:

| Tool | What it is | Get it |
|------|------------|--------|
| **Claude Code** | Anthropic's AI in your terminal | [claude.ai/code](https://claude.ai/code) |
| **Cursor** | AI-first code editor (like VS Code with AI built in) | [cursor.com](https://cursor.com) |
| **Windsurf** | AI code editor by Codeium | [codeium.com/windsurf](https://codeium.com/windsurf) |
| **Cline** | AI coding extension for VS Code | VS Code extension marketplace |
| **Continue** | Open-source AI coding assistant | [continue.dev](https://continue.dev) |

If you don't have one yet and you're not sure where to start: try **Cursor**. It has the gentlest learning curve if you're coming from a design background.

---

#### 3. What MCP is (one sentence)

MCP (Model Context Protocol) is a standard way to give AI tools access to extra capabilities — like a browser, a database, or your file system. This tool is one of those capabilities. You install it by adding a few lines of config to your AI tool, and it shows up automatically in your AI's toolbox.

---

#### 4. A web project running locally

This tool inspects CSS in a live browser. That means you need a web project running on your computer — usually a React, Vue, or similar app that you're actively developing.

When you run your project locally, it opens at an address like `http://localhost:5173` or `http://localhost:3000`. That's the URL you'll give this tool.

If you don't have a local project, this tool won't have anything to inspect. It's designed for active development workflows, not for inspecting live public websites.

---

### How to install

You don't need to install anything upfront. When you configure your AI tool (next step), it will download and run `browser-inspector-mcp` automatically the first time it's needed using a tool called `npx`.

The first time it runs, it will also download a browser called Chromium (~170MB). This is the headless browser the tool uses to inspect your page — it runs invisibly in the background and has nothing to do with your regular Chrome or Safari.

---

### How to configure your AI tool

You need to add a small piece of configuration — a JSON block — to a file on your computer. JSON is just a structured text format. The block looks like this:

```json
{
  "mcpServers": {
    "browser-inspector": {
      "command": "npx",
      "args": ["-y", "browser-inspector-mcp"]
    }
  }
}
```

The file you add it to depends on which AI tool you're using. Find yours below.

**Important:** If the config file already has other content in it, you're adding to it — not replacing it. See the examples below.

---

#### Claude Code

**File location:** `~/.claude.json`

The `~` means your home folder. On a Mac, that's `/Users/yourname/`. The file might not exist yet — if it doesn't, create it.

Open Terminal and run:
```
open -e ~/.claude.json
```
This opens the file in TextEdit. If the file didn't exist, create a new one and paste:

```json
{
  "mcpServers": {
    "browser-inspector": {
      "command": "npx",
      "args": ["-y", "browser-inspector-mcp"]
    }
  }
}
```

If the file already has content, find the `"mcpServers"` section and add the `"browser-inspector"` block inside it. Don't delete what's already there.

Save the file, then **quit and reopen Claude Code**.

---

#### Cursor

**File location:** `~/.cursor/mcp.json` (applies to all your projects)
or `.cursor/mcp.json` inside a specific project folder (applies to that project only)

In Cursor, go to: **Settings → MCP** — there's usually a UI to add MCP servers directly, which is easier than editing the file manually. If you prefer to edit the file, add the same JSON block above.

**Restart Cursor** after saving.

---

#### Windsurf

**File location:** `~/.codeium/windsurf/mcp_config.json`

Open the file, add the same JSON block, save, and **restart Windsurf**.

---

#### Cline (VS Code extension)

In VS Code with Cline installed: open the Cline sidebar → click the settings icon → find "MCP Servers" → add a new server with the command `npx` and args `["-y", "browser-inspector-mcp"]`.

---

#### Other tools (Continue, OpenCode, Codex, etc.)

Any MCP-compatible tool accepts the same config block. Find where your tool stores its MCP server configuration and add it there.

---

### How to use it

Once configured, the tools are available automatically. You don't call them by name — just describe what you're working on.

**Starting a session:** Tell your AI what URL your dev server is running on:

```
I'm working on the dashboard at http://localhost:5173 — the button styles aren't applying correctly.
```

The AI will use the tools it needs. The browser session stays open for the whole conversation — you only need to mention the URL once.

**What the AI does behind the scenes:**

```
You:  "The icon in the panel header isn't picking up the brand color"

AI:   → browser_inspect(action="dom", selector=".panel-header")
        sees the real rendered class names, finds the icon is <span class="panel__header-icon">
      → browser_inspect(action="styles", selector=".panel__header-icon", properties=["color"])
        sees there's an explicit color rule on the icon overriding the parent
      → fixes the right rule, first try
```

No DevTools. No copy-paste. No back-and-forth.

</details>

---

## The problem this solves

### What normally happens

You ask your AI tool to fix a styling issue. It reads the source files, writes a CSS change, and applies it. You check the browser. Still wrong. The AI tries again. Still wrong. After a few rounds, you open DevTools yourself, find the actual element, copy the HTML, paste it back into the chat — and only then does the AI understand what it was actually dealing with.

That manual copy-paste step? That's the gap this tool closes.

### Why it keeps happening

AI reads source files. Browsers render something different.

Modern component libraries like Ant Design, Material UI, and Radix generate their own class names at runtime — names that don't appear anywhere in your source code. Your JSX says `<Menu>`. The browser renders `ant-dropdown-menu-item-container`. The AI writes CSS for `ant-menu-item` because that's what it found in the source. The rule never applies.

There's also a second problem: even when the AI targets the right element, it can't confirm whether its change landed. Did the CSS apply? Did something override it? Was `font-weight` already bold, or just appearing that way? Without DevTools, every answer is a guess.

### Three ways this plays out

**Problem 1 — Reading the recipe, not the dish**

A tailor studies the original design pattern for a suit — the flat paper template. They know every seam. But the suit in front of them was made by someone else who made modifications. The pattern is not what was built.

That's AI reading CSS source files. It's reading the original pattern. The browser rendered something different. The AI keeps altering the wrong seam.

*The inspector is the fitting room. You check what was actually built before you touch it.*

**Problem 2 — Adjusting the aerial blind**

You're in the backyard adjusting a TV aerial. Someone inside is watching the picture. Every time you move it, you shout "better or worse?" and wait. Each adjustment is a round trip.

That's the push-check-push cycle. The AI makes a change. You walk to the browser. You look. You come back and type what you saw. Each loop is a round trip with no direct connection between the person holding the aerial and the person watching the screen.

*This tool is the wire. The AI checks the result itself, without you walking back and forth.*

**Problem 3 — Treating the wrong patient**

A doctor sees someone who looks pale and tired. Without examining them, they assume iron deficiency and prescribe accordingly. Six weeks later, nothing's changed. It was thyroid all along.

The AI looks at text that appears bold in a screenshot. It assumes `font-weight` is set high. It tries to override it. But the value was 400 — the text just rendered that way at that size. The AI spent the session solving a problem that didn't exist.

*Inspect before you prescribe. The computed value is the examination.*

---

## Who it's for

**Designers who use AI coding tools** — Cursor, Claude Code, Windsurf, Cline. You think and verify visually. Opening DevTools and pasting HTML back into a chat is a jarring context switch that breaks your flow. This removes that step entirely.

**Frontend engineers** who want their AI pair programmer to close the loop on its own — inspect, change, verify — without needing to be walked through what the browser is actually rendering.

**Design system contributors** working with component libraries where runtime class names don't match source. Ant Design, Material UI, Radix, Shadcn — anywhere the browser builds a different structure than what's in the JSX.

**Anyone debugging CSS** who has ever said "why isn't this applying?" and wished the AI could just look at the browser instead of guessing.

---

## One tool, four actions

### `dom` — See what the browser actually built

Before the AI writes any CSS, it calls this. Returns the real rendered HTML — actual runtime class names, actual DOM structure — for any element you point it at.

This is the fitting room. The AI checks what was actually built before touching it.

### `styles` — See every CSS rule and who's winning

When a style change isn't showing up, this returns the full CSS cascade for an element: every rule that matched, in order, where it came from (stylesheet + line number), and which properties are active vs overridden.

The AI can see whether your rule even reached the element, whether something is overriding it, and exactly where the winning rule is defined.

### `diff` — Confirm a change actually landed

Before/after style comparison. First call saves a snapshot. Second call — after a CSS change — shows exactly which properties changed and by how much. If nothing changed, it says so explicitly.

This is how the AI knows its fix worked without you checking the browser manually.

### `screenshot` — Visual snapshot of any element

Returns a cropped screenshot of any element. The AI receives the image inline and can see what it's working with.

> **Note on screenshot accuracy:** Screenshots render at 1440×900 in a headless browser. If your app has responsive breakpoints, the screenshot may not match what you see in your own browser at your current window size. The CSS data actions (`dom`, `styles`, `diff`) are unaffected — they return accurate data regardless of viewport.

---

## Requirements

- Node.js 18 or higher — [nodejs.org](https://nodejs.org)
- An MCP-compatible AI coding tool (Claude Code, Cursor, Windsurf, Cline, Continue, OpenCode, Codex, or any other)
- A web project running locally that you want to inspect

---

## What's coming

- **Live style injection** — AI writes directly to the browser via CDP, you see the change instantly, source file only gets touched once the result is confirmed. No file save or hot reload in the loop.
- **Browser extension handoff** — drag a rectangle over any element in your browser, it sends the visual + DOM + computed styles directly to your AI session. One gesture replaces the manual copy-paste entirely.
- **Portal and shadow DOM support** — component library elements that render outside their parent (dropdowns, modals, tooltips).

---

## License

MIT
