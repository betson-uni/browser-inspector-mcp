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

import { BROWSER_INSPECT_TOOL, browserInspect } from "./tools/browser-inspect.js";
import { closeBrowser } from "./browser.js";

const server = new Server(
  {
    name: "browser-inspector-mcp",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [BROWSER_INSPECT_TOOL],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name !== "browser_inspect") {
      throw new Error(`Unknown tool: ${name}`);
    }

    const result = await browserInspect(args);

    // screenshot action returns an image — send it inline so Claude sees it
    if (result.image) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { selector: result.selector, found: result.found, url: result.url, dimensions: result.dimensions },
              null,
              2
            ),
          },
          {
            type: "image",
            data: result.image,
            mimeType: "image/png",
          },
        ],
      };
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
