"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultMCPToolCacheKey = exports.MCPServerSSE = exports.MCPServerStreamableHttp = exports.MCPServerStdio = exports.MCPTool = exports.BaseMCPServerSSE = exports.BaseMCPServerStreamableHttp = exports.BaseMCPServerStdio = exports.DEFAULT_SSE_MCP_CLIENT_LOGGER_NAME = exports.DEFAULT_STREAMABLE_HTTP_MCP_CLIENT_LOGGER_NAME = exports.DEFAULT_STDIO_MCP_CLIENT_LOGGER_NAME = void 0;
exports.invalidateServerToolsCache = invalidateServerToolsCache;
exports.getAllMcpTools = getAllMcpTools;
exports.mcpToFunctionTool = mcpToFunctionTool;
const tool_1 = require("./tool.js");
const errors_1 = require("./errors.js");
const _shims_1 = require("@openai/agents-core/_shims");
const tracing_1 = require("./tracing/index.js");
const logger_1 = require("./logger.js");
const debug_1 = __importDefault(require("debug"));
const zod_1 = require("zod");
exports.DEFAULT_STDIO_MCP_CLIENT_LOGGER_NAME = 'openai-agents:stdio-mcp-client';
exports.DEFAULT_STREAMABLE_HTTP_MCP_CLIENT_LOGGER_NAME = 'openai-agents:streamable-http-mcp-client';
exports.DEFAULT_SSE_MCP_CLIENT_LOGGER_NAME = 'openai-agents:sse-mcp-client';
class BaseMCPServerStdio {
    cacheToolsList;
    _cachedTools = undefined;
    toolFilter;
    logger;
    constructor(options) {
        this.logger =
            options.logger ?? (0, logger_1.getLogger)(exports.DEFAULT_STDIO_MCP_CLIENT_LOGGER_NAME);
        this.cacheToolsList = options.cacheToolsList ?? false;
        this.toolFilter = options.toolFilter;
    }
    /**
     * Logs a debug message when debug logging is enabled.
     * @param buildMessage A function that returns the message to log.
     */
    debugLog(buildMessage) {
        if (debug_1.default.enabled(this.logger.namespace)) {
            // only when this is true, the function to build the string is called
            this.logger.debug(buildMessage());
        }
    }
}
exports.BaseMCPServerStdio = BaseMCPServerStdio;
class BaseMCPServerStreamableHttp {
    cacheToolsList;
    _cachedTools = undefined;
    toolFilter;
    logger;
    constructor(options) {
        this.logger =
            options.logger ??
                (0, logger_1.getLogger)(exports.DEFAULT_STREAMABLE_HTTP_MCP_CLIENT_LOGGER_NAME);
        this.cacheToolsList = options.cacheToolsList ?? false;
        this.toolFilter = options.toolFilter;
    }
    /**
     * Logs a debug message when debug logging is enabled.
     * @param buildMessage A function that returns the message to log.
     */
    debugLog(buildMessage) {
        if (debug_1.default.enabled(this.logger.namespace)) {
            // only when this is true, the function to build the string is called
            this.logger.debug(buildMessage());
        }
    }
}
exports.BaseMCPServerStreamableHttp = BaseMCPServerStreamableHttp;
class BaseMCPServerSSE {
    cacheToolsList;
    _cachedTools = undefined;
    toolFilter;
    logger;
    constructor(options) {
        this.logger =
            options.logger ?? (0, logger_1.getLogger)(exports.DEFAULT_SSE_MCP_CLIENT_LOGGER_NAME);
        this.cacheToolsList = options.cacheToolsList ?? false;
        this.toolFilter = options.toolFilter;
    }
    /**
     * Logs a debug message when debug logging is enabled.
     * @param buildMessage A function that returns the message to log.
     */
    debugLog(buildMessage) {
        if (debug_1.default.enabled(this.logger.namespace)) {
            // only when this is true, the function to build the string is called
            this.logger.debug(buildMessage());
        }
    }
}
exports.BaseMCPServerSSE = BaseMCPServerSSE;
/**
 * Minimum MCP tool data definition.
 * This type definition does not intend to cover all possible properties.
 * It supports the properties that are used in this SDK.
 */
exports.MCPTool = zod_1.z.object({
    name: zod_1.z.string(),
    description: zod_1.z.string().optional(),
    inputSchema: zod_1.z.object({
        type: zod_1.z.literal('object'),
        properties: zod_1.z.record(zod_1.z.string(), zod_1.z.any()),
        required: zod_1.z.array(zod_1.z.string()),
        additionalProperties: zod_1.z.boolean(),
    }),
});
/**
 * Public interface of an MCP server that provides tools.
 * You can use this class to pass MCP server settings to your agent.
 */
class MCPServerStdio extends BaseMCPServerStdio {
    underlying;
    constructor(options) {
        super(options);
        this.underlying = new _shims_1.MCPServerStdio(options);
    }
    get name() {
        return this.underlying.name;
    }
    connect() {
        return this.underlying.connect();
    }
    close() {
        return this.underlying.close();
    }
    async listTools() {
        if (this.cacheToolsList && this._cachedTools) {
            return this._cachedTools;
        }
        const tools = await this.underlying.listTools();
        if (this.cacheToolsList) {
            this._cachedTools = tools;
        }
        return tools;
    }
    callTool(toolName, args) {
        return this.underlying.callTool(toolName, args);
    }
    invalidateToolsCache() {
        return this.underlying.invalidateToolsCache();
    }
}
exports.MCPServerStdio = MCPServerStdio;
class MCPServerStreamableHttp extends BaseMCPServerStreamableHttp {
    underlying;
    constructor(options) {
        super(options);
        this.underlying = new _shims_1.MCPServerStreamableHttp(options);
    }
    get name() {
        return this.underlying.name;
    }
    connect() {
        return this.underlying.connect();
    }
    close() {
        return this.underlying.close();
    }
    async listTools() {
        if (this.cacheToolsList && this._cachedTools) {
            return this._cachedTools;
        }
        const tools = await this.underlying.listTools();
        if (this.cacheToolsList) {
            this._cachedTools = tools;
        }
        return tools;
    }
    callTool(toolName, args) {
        return this.underlying.callTool(toolName, args);
    }
    invalidateToolsCache() {
        return this.underlying.invalidateToolsCache();
    }
}
exports.MCPServerStreamableHttp = MCPServerStreamableHttp;
class MCPServerSSE extends BaseMCPServerSSE {
    underlying;
    constructor(options) {
        super(options);
        this.underlying = new _shims_1.MCPServerSSE(options);
    }
    get name() {
        return this.underlying.name;
    }
    connect() {
        return this.underlying.connect();
    }
    close() {
        return this.underlying.close();
    }
    async listTools() {
        if (this.cacheToolsList && this._cachedTools) {
            return this._cachedTools;
        }
        const tools = await this.underlying.listTools();
        if (this.cacheToolsList) {
            this._cachedTools = tools;
        }
        return tools;
    }
    callTool(toolName, args) {
        return this.underlying.callTool(toolName, args);
    }
    invalidateToolsCache() {
        return this.underlying.invalidateToolsCache();
    }
}
exports.MCPServerSSE = MCPServerSSE;
/**
 * Fetches and flattens all tools from multiple MCP servers.
 * Logs and skips any servers that fail to respond.
 */
const _cachedTools = {};
const _cachedToolKeysByServer = {};
/**
 * Remove cached tools for the given server so the next lookup fetches fresh data.
 *
 * @param serverName - Name of the MCP server whose cache should be cleared.
 */
async function invalidateServerToolsCache(serverName) {
    const cachedKeys = _cachedToolKeysByServer[serverName];
    if (cachedKeys) {
        for (const cacheKey of cachedKeys) {
            delete _cachedTools[cacheKey];
        }
        delete _cachedToolKeysByServer[serverName];
        return;
    }
    delete _cachedTools[serverName];
    for (const cacheKey of Object.keys(_cachedTools)) {
        if (cacheKey.startsWith(`${serverName}:`)) {
            delete _cachedTools[cacheKey];
        }
    }
}
/**
 * Default cache key generator for MCP tools.
 * Uses server name, or server+agent if using callable filter.
 */
const defaultMCPToolCacheKey = ({ server, agent, }) => {
    if (server.toolFilter && typeof server.toolFilter === 'function' && agent) {
        return `${server.name}:${agent.name}`;
    }
    return server.name;
};
exports.defaultMCPToolCacheKey = defaultMCPToolCacheKey;
/**
 * Fetches all function tools from a single MCP server.
 */
async function getFunctionToolsFromServer({ server, convertSchemasToStrict, runContext, agent, generateMCPToolCacheKey, }) {
    const cacheKey = (generateMCPToolCacheKey || exports.defaultMCPToolCacheKey)({
        server,
        agent,
        runContext,
    });
    // Use cache key generator injected from the outside, or the default if absent.
    if (server.cacheToolsList && _cachedTools[cacheKey]) {
        return _cachedTools[cacheKey].map((t) => mcpToFunctionTool(t, server, convertSchemasToStrict));
    }
    const listToolsForServer = async (span) => {
        const fetchedMcpTools = await server.listTools();
        let mcpTools = fetchedMcpTools;
        if (runContext && agent) {
            const context = { runContext, agent, serverName: server.name };
            const filteredTools = [];
            for (const tool of fetchedMcpTools) {
                const filter = server.toolFilter;
                if (filter) {
                    if (typeof filter === 'function') {
                        const filtered = await filter(context, tool);
                        if (!filtered) {
                            logger_1.logger.debug(`MCP Tool (server: ${server.name}, tool: ${tool.name}) is blocked by the callable filter.`);
                            continue;
                        }
                    }
                    else {
                        const allowedToolNames = filter.allowedToolNames ?? [];
                        const blockedToolNames = filter.blockedToolNames ?? [];
                        if (allowedToolNames.length > 0 || blockedToolNames.length > 0) {
                            const allowed = allowedToolNames.length > 0
                                ? allowedToolNames.includes(tool.name)
                                : true;
                            const blocked = blockedToolNames.length > 0
                                ? blockedToolNames.includes(tool.name)
                                : false;
                            if (!allowed || blocked) {
                                if (blocked) {
                                    logger_1.logger.debug(`MCP Tool (server: ${server.name}, tool: ${tool.name}) is blocked by the static filter.`);
                                }
                                else if (!allowed) {
                                    logger_1.logger.debug(`MCP Tool (server: ${server.name}, tool: ${tool.name}) is not allowed by the static filter.`);
                                }
                                continue;
                            }
                        }
                    }
                }
                filteredTools.push(tool);
            }
            mcpTools = filteredTools;
        }
        if (span) {
            span.spanData.result = mcpTools.map((t) => t.name);
        }
        const tools = mcpTools.map((t) => mcpToFunctionTool(t, server, convertSchemasToStrict));
        // Cache store
        if (server.cacheToolsList) {
            _cachedTools[cacheKey] = mcpTools;
            if (!_cachedToolKeysByServer[server.name]) {
                _cachedToolKeysByServer[server.name] = new Set();
            }
            _cachedToolKeysByServer[server.name].add(cacheKey);
        }
        return tools;
    };
    if (!(0, tracing_1.getCurrentTrace)()) {
        return listToolsForServer();
    }
    return (0, tracing_1.withMCPListToolsSpan)(listToolsForServer, {
        data: { server: server.name },
    });
}
/**
 * Returns all MCP tools from the provided servers, using the function tool conversion.
 * If runContext and agent are provided, callable tool filters will be applied.
 */
async function getAllMcpTools(mcpServersOrOpts, runContext, agent, convertSchemasToStrict = false) {
    const opts = Array.isArray(mcpServersOrOpts)
        ? {
            mcpServers: mcpServersOrOpts,
            runContext,
            agent,
            convertSchemasToStrict,
        }
        : mcpServersOrOpts;
    const { mcpServers, convertSchemasToStrict: convertSchemasToStrictFromOpts = false, runContext: runContextFromOpts, agent: agentFromOpts, generateMCPToolCacheKey, } = opts;
    const allTools = [];
    const toolNames = new Set();
    for (const server of mcpServers) {
        const serverTools = await getFunctionToolsFromServer({
            server,
            convertSchemasToStrict: convertSchemasToStrictFromOpts,
            runContext: runContextFromOpts,
            agent: agentFromOpts,
            generateMCPToolCacheKey,
        });
        const serverToolNames = new Set(serverTools.map((t) => t.name));
        const intersection = [...serverToolNames].filter((n) => toolNames.has(n));
        if (intersection.length > 0) {
            throw new errors_1.UserError(`Duplicate tool names found across MCP servers: ${intersection.join(', ')}`);
        }
        for (const t of serverTools) {
            toolNames.add(t.name);
            allTools.push(t);
        }
    }
    return allTools;
}
/**
 * Converts an MCP tool definition to a function tool for the Agents SDK.
 */
function mcpToFunctionTool(mcpTool, server, convertSchemasToStrict) {
    async function invoke(input, _context) {
        let args = {};
        if (typeof input === 'string' && input) {
            args = JSON.parse(input);
        }
        else if (typeof input === 'object' && input != null) {
            args = input;
        }
        const currentSpan = (0, tracing_1.getCurrentSpan)();
        if (currentSpan) {
            currentSpan.spanData['mcp_data'] = { server: server.name };
        }
        const content = await server.callTool(mcpTool.name, args);
        return content.length === 1 ? content[0] : content;
    }
    const schema = {
        ...mcpTool.inputSchema,
        type: mcpTool.inputSchema?.type ?? 'object',
        properties: mcpTool.inputSchema?.properties ?? {},
        required: mcpTool.inputSchema?.required ?? [],
        additionalProperties: mcpTool.inputSchema?.additionalProperties ?? false,
    };
    if (convertSchemasToStrict || schema.additionalProperties === true) {
        try {
            const strictSchema = ensureStrictJsonSchema(schema);
            return (0, tool_1.tool)({
                name: mcpTool.name,
                description: mcpTool.description || '',
                parameters: strictSchema,
                strict: true,
                execute: invoke,
            });
        }
        catch (e) {
            logger_1.logger.warn(`Error converting MCP schema to strict mode: ${e}`);
        }
    }
    const nonStrictSchema = {
        ...schema,
        additionalProperties: true,
    };
    return (0, tool_1.tool)({
        name: mcpTool.name,
        description: mcpTool.description || '',
        parameters: nonStrictSchema,
        strict: false,
        execute: invoke,
    });
}
/**
 * Ensures the given JSON schema is strict (no additional properties, required fields set).
 */
function ensureStrictJsonSchema(schema) {
    const out = {
        ...schema,
        additionalProperties: false,
    };
    if (!out.required)
        out.required = [];
    return out;
}
//# sourceMappingURL=mcp.js.map