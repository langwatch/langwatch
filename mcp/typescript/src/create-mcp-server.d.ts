// Minimal type declaration — avoids pulling mcp-server's full dependency tree
// into the langwatch app's typecheck scope. The actual return type is McpServer,
// but we only expose the connect() and tool() methods that handler.ts +
// in-app tool registrations (e.g. registerGovernanceMcpTools) use.
export declare function createMcpServer(): {
  connect(transport: unknown): Promise<void>;
  tool(...args: unknown[]): unknown;
};
