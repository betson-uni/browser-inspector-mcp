#!/usr/bin/env node
/**
 * index.js — Browser CSS Inspector MCP Server
 *
 * Gives AI coding tools the same CSS visibility a human has in DevTools.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { GET_DOM_TOOL, getDom } from "./tools/get-dom.js";
import { INSPECT_STYLES_TOOL, inspectStyles } from "./tools/inspect-styles.js";
import { SCREENSHOT_ELEMENT_TOOL, screenshotElement } from "./tools/screenshot-element.js";
import { DIFF_STYLES_TOOL, diffStyles } from "./tools/diff-styles.js";
import { closeBrowser } from "./browser.js";

const server = new Server(
  {
    name: "browser-inspector-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [GET_DOM_TOOL, INSPECT_STYLES_TOOL, SCREENSHOT_ELEMENT_TOOL, DIFF_STYLES_TOOL],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    if (name === "get_dom") {
      result = await getDom(args);
    } else if (name === "inspect_styles") {
      result = await inspectStyles(args);
    } else if (name === "screenshot_element") {
      result = await screenshotElement(args);
      // Return image content if we got one, otherwise fall through to text (error/not-found cases)
      if (result.image) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ selector: result.selector, found: result.found, url: result.url, dimensions: result.dimensions }, null, 2),
            },
            {
              type: "image",
              data: result.image,
              mimeType: "image/png",
            },
          ],
        };
      }
    } else if (name === "diff_styles") {
      result = await diffStyles(args);
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: error.message,
            tool: name,
            args,
          }),
        },
      ],
      isError: true,
    };
  }
});

// Start
const transport = new StdioServerTransport();
await server.connect(transport);

// Clean up browser on shutdown
process.on("SIGINT", async () => {
  await closeBrowser();
  process.exit(0);
});
