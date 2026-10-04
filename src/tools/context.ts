import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BepaidClient } from "../bepaid/client.js";
import type { Config } from "../config.js";
import { loadRoster, type Roster } from "../roster/loadRoster.js";

export interface ToolContext {
  config: Config;
  client: BepaidClient;
  rosterEnabled: boolean; // ROSTER_XLSX_PATH is set: roster tools are registered
  getRoster(): Promise<Roster>;
}

export function createContext(config: Config, client = new BepaidClient(config.credentials)): ToolContext {
  return {
    config,
    client,
    rosterEnabled: Boolean(config.rosterPath),
    async getRoster() {
      if (!config.rosterPath) throw new Error("Roster is not configured: set ROSTER_XLSX_PATH");
      return loadRoster(config.rosterPath, { bepaidUrlMarkers: config.bepaidUrlMarkers });
    },
  };
}

export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Wraps a handler so thrown errors come back as tool errors the model can read and act on. */
export function safe<A>(handler: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await handler(args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  };
}
