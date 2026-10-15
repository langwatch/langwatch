import type { McpStatus } from "./mcp-api.ts";

/** Every view reads the console's one status poll rather than polling it again. */
export type ViewProps = {
  status?: McpStatus;
  error?: Error;
  refresh: () => Promise<void>;
};
