import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBepaidTools } from "./tools/bepaidTools.js";
import type { ToolContext } from "./tools/context.js";
import { registerRosterTools } from "./tools/rosterTools.js";

// dist/server.js -> package root, both in the repo and in an installed package.
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "bepaid-mcp", version });
  registerBepaidTools(server, ctx);
  // The roster module (groups/payers workbook) is optional: without it the server is a generic bePaid MCP.
  if (ctx.rosterEnabled) registerRosterTools(server, ctx);
  return server;
}
