import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { BaseMCPServerStdio, BaseMCPServerStreamableHttp, BaseMCPServerSSE, CallToolResultContent, DefaultMCPServerStdioOptions, InitializeResult, MCPServerStdioOptions, MCPServerStreamableHttpOptions, MCPServerSSEOptions, MCPTool } from '../../mcp';
export interface SessionMessage {
    message: any;
}
export declare class NodeMCPServerStdio extends BaseMCPServerStdio {
    protected session: Client | null;
    protected _cacheDirty: boolean;
    protected _toolsList: any[];
    protected serverInitializeResult: InitializeResult | null;
    protected clientSessionTimeoutSeconds?: number;
    protected timeout: number;
    params: DefaultMCPServerStdioOptions;
    private _name;
    private transport;
    constructor(params: MCPServerStdioOptions);
    connect(): Promise<void>;
    invalidateToolsCache(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(toolName: string, args: Record<string, unknown> | null): Promise<CallToolResultContent>;
    get name(): string;
    close(): Promise<void>;
}
export declare class NodeMCPServerSSE extends BaseMCPServerSSE {
    protected session: Client | null;
    protected _cacheDirty: boolean;
    protected _toolsList: any[];
    protected serverInitializeResult: InitializeResult | null;
    protected clientSessionTimeoutSeconds?: number;
    protected timeout: number;
    params: MCPServerSSEOptions;
    private _name;
    private transport;
    constructor(params: MCPServerSSEOptions);
    connect(): Promise<void>;
    invalidateToolsCache(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(toolName: string, args: Record<string, unknown> | null): Promise<CallToolResultContent>;
    get name(): string;
    close(): Promise<void>;
}
export declare class NodeMCPServerStreamableHttp extends BaseMCPServerStreamableHttp {
    protected session: Client | null;
    protected _cacheDirty: boolean;
    protected _toolsList: any[];
    protected serverInitializeResult: InitializeResult | null;
    protected clientSessionTimeoutSeconds?: number;
    protected timeout: number;
    params: MCPServerStreamableHttpOptions;
    private _name;
    private transport;
    constructor(params: MCPServerStreamableHttpOptions);
    connect(): Promise<void>;
    invalidateToolsCache(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(toolName: string, args: Record<string, unknown> | null): Promise<CallToolResultContent>;
    get name(): string;
    close(): Promise<void>;
}
