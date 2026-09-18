import { BaseMCPServerSSE, BaseMCPServerStdio, BaseMCPServerStreamableHttp, CallToolResultContent, MCPServerSSEOptions, MCPServerStdioOptions, MCPServerStreamableHttpOptions, MCPTool } from '../../mcp';
export declare class MCPServerStdio extends BaseMCPServerStdio {
    constructor(params: MCPServerStdioOptions);
    get name(): string;
    connect(): Promise<void>;
    close(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(_toolName: string, _args: Record<string, unknown> | null): Promise<CallToolResultContent>;
    invalidateToolsCache(): Promise<void>;
}
export declare class MCPServerStreamableHttp extends BaseMCPServerStreamableHttp {
    constructor(params: MCPServerStreamableHttpOptions);
    get name(): string;
    connect(): Promise<void>;
    close(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(_toolName: string, _args: Record<string, unknown> | null): Promise<CallToolResultContent>;
    invalidateToolsCache(): Promise<void>;
}
export declare class MCPServerSSE extends BaseMCPServerSSE {
    constructor(params: MCPServerSSEOptions);
    get name(): string;
    connect(): Promise<void>;
    close(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(_toolName: string, _args: Record<string, unknown> | null): Promise<CallToolResultContent>;
    invalidateToolsCache(): Promise<void>;
}
