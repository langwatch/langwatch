// Minimal type declaration — avoids pulling mcp-server's full dependency tree
// into the langwatch app's typecheck scope. The actual return type is McpServer,
// but we only expose the connect() method that handler.ts uses.
export declare function createMcpServer(requireApiKey: () => string): {
  connect(transport: unknown): Promise<void>;
};
