#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { createContext } from "./tools/context.js";

const server = createServer(createContext(loadConfig()));
await server.connect(new StdioServerTransport());
// stdout carries the MCP protocol; diagnostics go to stderr.
console.error("bepaid-mcp running on stdio");
