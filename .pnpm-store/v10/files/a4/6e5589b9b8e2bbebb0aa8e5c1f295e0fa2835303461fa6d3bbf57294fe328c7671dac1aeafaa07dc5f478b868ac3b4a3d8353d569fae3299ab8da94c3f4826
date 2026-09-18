import { FunctionTool, Tool } from './tool';
import { Logger } from './logger';
import { z } from 'zod';
import { JsonObjectSchemaNonStrict, JsonObjectSchemaStrict, UnknownContext } from './types';
import type { MCPToolFilterCallable, MCPToolFilterStatic } from './mcpUtil';
import type { RunContext } from './runContext';
import type { Agent } from './agent';
export declare const DEFAULT_STDIO_MCP_CLIENT_LOGGER_NAME = "openai-agents:stdio-mcp-client";
export declare const DEFAULT_STREAMABLE_HTTP_MCP_CLIENT_LOGGER_NAME = "openai-agents:streamable-http-mcp-client";
export declare const DEFAULT_SSE_MCP_CLIENT_LOGGER_NAME = "openai-agents:sse-mcp-client";
/**
 * Interface for MCP server implementations.
 * Provides methods for connecting, listing tools, calling tools, and cleanup.
 */
export interface MCPServer {
    cacheToolsList: boolean;
    toolFilter?: MCPToolFilterCallable | MCPToolFilterStatic;
    connect(): Promise<void>;
    readonly name: string;
    close(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(toolName: string, args: Record<string, unknown> | null): Promise<CallToolResultContent>;
    invalidateToolsCache(): Promise<void>;
}
export declare abstract class BaseMCPServerStdio implements MCPServer {
    cacheToolsList: boolean;
    protected _cachedTools: any[] | undefined;
    toolFilter?: MCPToolFilterCallable | MCPToolFilterStatic;
    protected logger: Logger;
    constructor(options: MCPServerStdioOptions);
    abstract get name(): string;
    abstract connect(): Promise<void>;
    abstract close(): Promise<void>;
    abstract listTools(): Promise<any[]>;
    abstract callTool(_toolName: string, _args: Record<string, unknown> | null): Promise<CallToolResultContent>;
    abstract invalidateToolsCache(): Promise<void>;
    /**
     * Logs a debug message when debug logging is enabled.
     * @param buildMessage A function that returns the message to log.
     */
    protected debugLog(buildMessage: () => string): void;
}
export declare abstract class BaseMCPServerStreamableHttp implements MCPServer {
    cacheToolsList: boolean;
    protected _cachedTools: any[] | undefined;
    toolFilter?: MCPToolFilterCallable | MCPToolFilterStatic;
    protected logger: Logger;
    constructor(options: MCPServerStreamableHttpOptions);
    abstract get name(): string;
    abstract connect(): Promise<void>;
    abstract close(): Promise<void>;
    abstract listTools(): Promise<any[]>;
    abstract callTool(_toolName: string, _args: Record<string, unknown> | null): Promise<CallToolResultContent>;
    abstract invalidateToolsCache(): Promise<void>;
    /**
     * Logs a debug message when debug logging is enabled.
     * @param buildMessage A function that returns the message to log.
     */
    protected debugLog(buildMessage: () => string): void;
}
export declare abstract class BaseMCPServerSSE implements MCPServer {
    cacheToolsList: boolean;
    protected _cachedTools: any[] | undefined;
    toolFilter?: MCPToolFilterCallable | MCPToolFilterStatic;
    protected logger: Logger;
    constructor(options: MCPServerSSEOptions);
    abstract get name(): string;
    abstract connect(): Promise<void>;
    abstract close(): Promise<void>;
    abstract listTools(): Promise<any[]>;
    abstract callTool(_toolName: string, _args: Record<string, unknown> | null): Promise<CallToolResultContent>;
    abstract invalidateToolsCache(): Promise<void>;
    /**
     * Logs a debug message when debug logging is enabled.
     * @param buildMessage A function that returns the message to log.
     */
    protected debugLog(buildMessage: () => string): void;
}
/**
 * Minimum MCP tool data definition.
 * This type definition does not intend to cover all possible properties.
 * It supports the properties that are used in this SDK.
 */
export declare const MCPTool: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    inputSchema: z.ZodObject<{
        type: z.ZodLiteral<"object">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        required: z.ZodArray<z.ZodString, "many">;
        additionalProperties: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        type: "object";
        required: string[];
        properties: Record<string, any>;
        additionalProperties: boolean;
    }, {
        type: "object";
        required: string[];
        properties: Record<string, any>;
        additionalProperties: boolean;
    }>;
}, "strip", z.ZodTypeAny, {
    name: string;
    inputSchema: {
        type: "object";
        required: string[];
        properties: Record<string, any>;
        additionalProperties: boolean;
    };
    description?: string | undefined;
}, {
    name: string;
    inputSchema: {
        type: "object";
        required: string[];
        properties: Record<string, any>;
        additionalProperties: boolean;
    };
    description?: string | undefined;
}>;
export type MCPTool = z.infer<typeof MCPTool>;
/**
 * Public interface of an MCP server that provides tools.
 * You can use this class to pass MCP server settings to your agent.
 */
export declare class MCPServerStdio extends BaseMCPServerStdio {
    private underlying;
    constructor(options: MCPServerStdioOptions);
    get name(): string;
    connect(): Promise<void>;
    close(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(toolName: string, args: Record<string, unknown> | null): Promise<CallToolResultContent>;
    invalidateToolsCache(): Promise<void>;
}
export declare class MCPServerStreamableHttp extends BaseMCPServerStreamableHttp {
    private underlying;
    constructor(options: MCPServerStreamableHttpOptions);
    get name(): string;
    connect(): Promise<void>;
    close(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(toolName: string, args: Record<string, unknown> | null): Promise<CallToolResultContent>;
    invalidateToolsCache(): Promise<void>;
}
export declare class MCPServerSSE extends BaseMCPServerSSE {
    private underlying;
    constructor(options: MCPServerSSEOptions);
    get name(): string;
    connect(): Promise<void>;
    close(): Promise<void>;
    listTools(): Promise<MCPTool[]>;
    callTool(toolName: string, args: Record<string, unknown> | null): Promise<CallToolResultContent>;
    invalidateToolsCache(): Promise<void>;
}
/**
 * Remove cached tools for the given server so the next lookup fetches fresh data.
 *
 * @param serverName - Name of the MCP server whose cache should be cleared.
 */
export declare function invalidateServerToolsCache(serverName: string): Promise<void>;
/**
 * Function signature for generating the MCP tool cache key.
 * Customizable so the cache key can depend on any context—server, agent, runContext, etc.
 */
export type MCPToolCacheKeyGenerator = (params: {
    server: MCPServer;
    agent?: Agent<any, any>;
    runContext?: RunContext<any>;
}) => string;
/**
 * Default cache key generator for MCP tools.
 * Uses server name, or server+agent if using callable filter.
 */
export declare const defaultMCPToolCacheKey: MCPToolCacheKeyGenerator;
/**
 * Options for fetching MCP tools.
 */
export type GetAllMcpToolsOptions<TContext> = {
    mcpServers: MCPServer[];
    convertSchemasToStrict?: boolean;
    runContext?: RunContext<TContext>;
    agent?: Agent<TContext, any>;
    generateMCPToolCacheKey?: MCPToolCacheKeyGenerator;
};
/**
 * Returns all MCP tools from the provided servers, using the function tool conversion.
 * If runContext and agent are provided, callable tool filters will be applied.
 */
export declare function getAllMcpTools<TContext = UnknownContext>(mcpServersOrOpts: MCPServer[] | GetAllMcpToolsOptions<TContext>, runContext?: RunContext<TContext>, agent?: Agent<TContext, any>, convertSchemasToStrict?: boolean): Promise<Tool<TContext>[]>;
/**
 * Converts an MCP tool definition to a function tool for the Agents SDK.
 */
export declare function mcpToFunctionTool(mcpTool: MCPTool, server: MCPServer, convertSchemasToStrict: boolean): FunctionTool<unknown, JsonObjectSchemaStrict<any>, string> | FunctionTool<unknown, JsonObjectSchemaNonStrict<any>, string>;
/**
 * Abstract base class for MCP servers that use a ClientSession for communication.
 * Handles session management, tool listing, tool calling, and cleanup.
 */
export interface BaseMCPServerStdioOptions {
    env?: Record<string, string>;
    cwd?: string;
    cacheToolsList?: boolean;
    clientSessionTimeoutSeconds?: number;
    name?: string;
    encoding?: string;
    encodingErrorHandler?: 'strict' | 'ignore' | 'replace';
    logger?: Logger;
    toolFilter?: MCPToolFilterCallable | MCPToolFilterStatic;
    timeout?: number;
}
export interface DefaultMCPServerStdioOptions extends BaseMCPServerStdioOptions {
    command: string;
    args?: string[];
}
export interface FullCommandMCPServerStdioOptions extends BaseMCPServerStdioOptions {
    fullCommand: string;
}
export type MCPServerStdioOptions = DefaultMCPServerStdioOptions | FullCommandMCPServerStdioOptions;
export interface MCPServerStreamableHttpOptions {
    url: string;
    cacheToolsList?: boolean;
    clientSessionTimeoutSeconds?: number;
    name?: string;
    logger?: Logger;
    toolFilter?: MCPToolFilterCallable | MCPToolFilterStatic;
    timeout?: number;
    authProvider?: any;
    requestInit?: any;
    fetch?: any;
    reconnectionOptions?: any;
    sessionId?: string;
}
export interface MCPServerSSEOptions {
    url: string;
    cacheToolsList?: boolean;
    clientSessionTimeoutSeconds?: number;
    name?: string;
    logger?: Logger;
    toolFilter?: MCPToolFilterCallable | MCPToolFilterStatic;
    timeout?: number;
    authProvider?: any;
    requestInit?: any;
    fetch?: any;
    eventSourceInit?: any;
}
/**
 * Represents a JSON-RPC request message.
 */
export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params?: Record<string, unknown>;
}
/**
 * Represents a JSON-RPC notification message (no response expected).
 */
export interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: Record<string, unknown>;
}
/**
 * Represents a JSON-RPC response message.
 */
export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number;
    result?: any;
    error?: any;
}
export interface CallToolResponse extends JsonRpcResponse {
    result: {
        content: {
            type: string;
            text: string;
        }[];
    };
}
export type CallToolResult = CallToolResponse['result'];
export type CallToolResultContent = CallToolResult['content'];
export interface InitializeResponse extends JsonRpcResponse {
    result: {
        protocolVersion: string;
        capabilities: {
            tools: Record<string, unknown>;
        };
        serverInfo: {
            name: string;
            version: string;
        };
    };
}
export type InitializeResult = InitializeResponse['result'];
