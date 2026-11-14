// Minimal type declaration — avoids pulling mcp-server's full dependency tree
// into the langwatch app's typecheck scope. The actual return type is McpServer,
// but we only expose the methods that the hosted MCP endpoint + in-app tool
// registrations (e.g. registerGovernanceMcpTools) use.
type LangWatchMcpServer = {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
  tool(...args: unknown[]): unknown;
};

export declare function createMcpServer(): LangWatchMcpServer;

/** Only the documentation tools: no config, API key or project is read. */
export declare function createDocsMcpServer(): LangWatchMcpServer;
