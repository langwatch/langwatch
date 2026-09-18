"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeMCPServerStreamableHttp = exports.NodeMCPServerSSE = exports.NodeMCPServerStdio = void 0;
const protocol_js_1 = require("@modelcontextprotocol/sdk/shared/protocol.js");
const mcp_1 = require("../../mcp.js");
const logger_1 = __importDefault(require("../../logger.js"));
function failedToImport(error) {
    logger_1.default.error(`
Failed to load the MCP SDK. Please install the @modelcontextprotocol/sdk package.

npm install @modelcontextprotocol/sdk
    `.trim());
    throw error;
}
function buildRequestOptions(clientSessionTimeoutSeconds, overrides) {
    const baseOptions = clientSessionTimeoutSeconds === undefined
        ? undefined
        : { timeout: clientSessionTimeoutSeconds * 1000 };
    const mergedOptions = { ...(baseOptions ?? {}), ...(overrides ?? {}) };
    return Object.keys(mergedOptions).length === 0 ? undefined : mergedOptions;
}
function hasSessionTransport(transport) {
    return (transport != null &&
        typeof transport.close === 'function' &&
        (typeof transport.terminateSession === 'function' ||
            transport.sessionId !== undefined));
}
class NodeMCPServerStdio extends mcp_1.BaseMCPServerStdio {
    session = null;
    _cacheDirty = true;
    _toolsList = [];
    serverInitializeResult = null;
    clientSessionTimeoutSeconds;
    timeout;
    params;
    _name;
    transport = null;
    constructor(params) {
        super(params);
        this.clientSessionTimeoutSeconds = params.clientSessionTimeoutSeconds ?? 5;
        this.timeout = params.timeout ?? protocol_js_1.DEFAULT_REQUEST_TIMEOUT_MSEC;
        if ('fullCommand' in params) {
            const elements = params.fullCommand.split(' ');
            const command = elements.shift();
            if (!command) {
                throw new Error('Invalid fullCommand: ' + params.fullCommand);
            }
            this.params = {
                ...params,
                command: command,
                args: elements,
                encoding: params.encoding || 'utf-8',
                encodingErrorHandler: params.encodingErrorHandler || 'strict',
            };
        }
        else {
            this.params = params;
        }
        this._name = params.name || `stdio: ${this.params.command}`;
    }
    async connect() {
        try {
            const { StdioClientTransport } = await Promise.resolve().then(() => __importStar(require('@modelcontextprotocol/sdk/client/stdio.js'))).catch(failedToImport);
            const { Client } = await Promise.resolve().then(() => __importStar(require('@modelcontextprotocol/sdk/client/index.js'))).catch(failedToImport);
            this.transport = new StdioClientTransport({
                command: this.params.command,
                args: this.params.args,
                env: this.params.env,
                cwd: this.params.cwd,
            });
            this.session = new Client({
                name: this._name,
                version: '1.0.0', // You may want to make this configurable
            });
            const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
            await this.session.connect(this.transport, requestOptions);
            this.serverInitializeResult = {
                serverInfo: { name: this._name, version: '1.0.0' },
            };
        }
        catch (e) {
            this.logger.error('Error initializing MCP server:', e);
            await this.close();
            throw e;
        }
        this.debugLog(() => `Connected to MCP server: ${this._name}`);
    }
    async invalidateToolsCache() {
        await (0, mcp_1.invalidateServerToolsCache)(this.name);
        this._cacheDirty = true;
    }
    async listTools() {
        const { ListToolsResultSchema } = await Promise.resolve().then(() => __importStar(require('@modelcontextprotocol/sdk/types.js'))).catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        if (this.cacheToolsList && !this._cacheDirty && this._toolsList) {
            return this._toolsList;
        }
        this._cacheDirty = false;
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
        const response = await this.session.listTools(undefined, requestOptions);
        this.debugLog(() => `Listed tools: ${JSON.stringify(response)}`);
        this._toolsList = ListToolsResultSchema.parse(response).tools;
        return this._toolsList;
    }
    async callTool(toolName, args) {
        const { CallToolResultSchema } = await Promise.resolve().then(() => __importStar(require('@modelcontextprotocol/sdk/types.js'))).catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds, { timeout: this.timeout });
        const response = await this.session.callTool({
            name: toolName,
            arguments: args ?? {},
        }, undefined, requestOptions);
        const parsed = CallToolResultSchema.parse(response);
        const result = parsed.content;
        this.debugLog(() => `Called tool ${toolName} (args: ${JSON.stringify(args)}, result: ${JSON.stringify(result)})`);
        return result;
    }
    get name() {
        return this._name;
    }
    async close() {
        const transport = this.transport;
        if (transport && typeof transport.terminateSession === 'function') {
            try {
                // Best-effort cleanup: we do not actively manage session lifecycles,
                // but if the server supports sessions we terminate to avoid leaks.
                await transport.terminateSession();
            }
            catch (error) {
                this.logger.warn('Failed to terminate MCP session:', error);
            }
        }
        if (transport) {
            await transport.close();
            this.transport = null;
        }
        if (this.session) {
            await this.session.close();
            this.session = null;
        }
    }
}
exports.NodeMCPServerStdio = NodeMCPServerStdio;
class NodeMCPServerSSE extends mcp_1.BaseMCPServerSSE {
    session = null;
    _cacheDirty = true;
    _toolsList = [];
    serverInitializeResult = null;
    clientSessionTimeoutSeconds;
    timeout;
    params;
    _name;
    transport = null;
    constructor(params) {
        super(params);
        this.clientSessionTimeoutSeconds = params.clientSessionTimeoutSeconds ?? 5;
        this.params = params;
        this._name = params.name || `sse: ${this.params.url}`;
        this.timeout = params.timeout ?? protocol_js_1.DEFAULT_REQUEST_TIMEOUT_MSEC;
    }
    async connect() {
        try {
            const { SSEClientTransport } = await Promise.resolve().then(() => __importStar(require('@modelcontextprotocol/sdk/client/sse.js'))).catch(failedToImport);
            const { Client } = await Promise.resolve().then(() => __importStar(require('@modelcontextprotocol/sdk/client/index.js'))).catch(failedToImport);
            this.transport = new SSEClientTransport(new URL(this.params.url), {
                authProvider: this.params.authProvider,
                requestInit: this.params.requestInit,
                eventSourceInit: this.params.eventSourceInit,
                fetch: this.params.fetch,
            });
            this.session = new Client({
                name: this._name,
                version: '1.0.0', // You may want to make this configurable
            });
            const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
            await this.session.connect(this.transport, requestOptions);
            this.serverInitializeResult = {
                serverInfo: { name: this._name, version: '1.0.0' },
            };
        }
        catch (e) {
            this.logger.error('Error initializing MCP server:', e);
            await this.close();
            throw e;
        }
        this.debugLog(() => `Connected to MCP server: ${this._name}`);
    }
    async invalidateToolsCache() {
        await (0, mcp_1.invalidateServerToolsCache)(this.name);
        this._cacheDirty = true;
    }
    async listTools() {
        const { ListToolsResultSchema } = await Promise.resolve().then(() => __importStar(require('@modelcontextprotocol/sdk/types.js'))).catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        if (this.cacheToolsList && !this._cacheDirty && this._toolsList) {
            return this._toolsList;
        }
        this._cacheDirty = false;
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
        const response = await this.session.listTools(undefined, requestOptions);
        this.debugLog(() => `Listed tools: ${JSON.stringify(response)}`);
        this._toolsList = ListToolsResultSchema.parse(response).tools;
        return this._toolsList;
    }
    async callTool(toolName, args) {
        const { CallToolResultSchema } = await Promise.resolve().then(() => __importStar(require('@modelcontextprotocol/sdk/types.js'))).catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds, { timeout: this.timeout });
        const response = await this.session.callTool({
            name: toolName,
            arguments: args ?? {},
        }, undefined, requestOptions);
        const parsed = CallToolResultSchema.parse(response);
        const result = parsed.content;
        this.debugLog(() => `Called tool ${toolName} (args: ${JSON.stringify(args)}, result: ${JSON.stringify(result)})`);
        return result;
    }
    get name() {
        return this._name;
    }
    async close() {
        const transport = this.transport;
        if (hasSessionTransport(transport)) {
            const sessionId = transport.sessionId;
            if (sessionId && typeof transport.terminateSession === 'function') {
                try {
                    // Best-effort cleanup: we do not actively manage session lifecycles,
                    // but if the server supports sessions we terminate to avoid leaks.
                    await transport.terminateSession();
                }
                catch (error) {
                    this.logger.warn('Failed to terminate MCP session:', error);
                }
            }
        }
        if (transport) {
            await transport.close();
            this.transport = null;
        }
        if (this.session) {
            await this.session.close();
            this.session = null;
        }
    }
}
exports.NodeMCPServerSSE = NodeMCPServerSSE;
class NodeMCPServerStreamableHttp extends mcp_1.BaseMCPServerStreamableHttp {
    session = null;
    _cacheDirty = true;
    _toolsList = [];
    serverInitializeResult = null;
    clientSessionTimeoutSeconds;
    timeout;
    params;
    _name;
    transport = null;
    constructor(params) {
        super(params);
        this.clientSessionTimeoutSeconds = params.clientSessionTimeoutSeconds ?? 5;
        this.params = params;
        this._name = params.name || `streamable-http: ${this.params.url}`;
        this.timeout = params.timeout ?? protocol_js_1.DEFAULT_REQUEST_TIMEOUT_MSEC;
    }
    async connect() {
        try {
            const { StreamableHTTPClientTransport } = await Promise.resolve().then(() => __importStar(require('@modelcontextprotocol/sdk/client/streamableHttp.js'))).catch(failedToImport);
            const { Client } = await Promise.resolve().then(() => __importStar(require('@modelcontextprotocol/sdk/client/index.js'))).catch(failedToImport);
            this.transport = new StreamableHTTPClientTransport(new URL(this.params.url), {
                authProvider: this.params.authProvider,
                requestInit: this.params.requestInit,
                fetch: this.params.fetch,
                reconnectionOptions: this.params.reconnectionOptions,
                sessionId: this.params.sessionId,
            });
            this.session = new Client({
                name: this._name,
                version: '1.0.0', // You may want to make this configurable
            });
            const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
            await this.session.connect(this.transport, requestOptions);
            this.serverInitializeResult = {
                serverInfo: { name: this._name, version: '1.0.0' },
            };
        }
        catch (e) {
            this.logger.error('Error initializing MCP server:', e);
            await this.close();
            throw e;
        }
        this.debugLog(() => `Connected to MCP server: ${this._name}`);
    }
    async invalidateToolsCache() {
        await (0, mcp_1.invalidateServerToolsCache)(this.name);
        this._cacheDirty = true;
    }
    async listTools() {
        const { ListToolsResultSchema } = await Promise.resolve().then(() => __importStar(require('@modelcontextprotocol/sdk/types.js'))).catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        if (this.cacheToolsList && !this._cacheDirty && this._toolsList) {
            return this._toolsList;
        }
        this._cacheDirty = false;
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds);
        const response = await this.session.listTools(undefined, requestOptions);
        this.debugLog(() => `Listed tools: ${JSON.stringify(response)}`);
        this._toolsList = ListToolsResultSchema.parse(response).tools;
        return this._toolsList;
    }
    async callTool(toolName, args) {
        const { CallToolResultSchema } = await Promise.resolve().then(() => __importStar(require('@modelcontextprotocol/sdk/types.js'))).catch(failedToImport);
        if (!this.session) {
            throw new Error('Server not initialized. Make sure you call connect() first.');
        }
        const requestOptions = buildRequestOptions(this.clientSessionTimeoutSeconds, { timeout: this.timeout });
        const response = await this.session.callTool({
            name: toolName,
            arguments: args ?? {},
        }, undefined, requestOptions);
        const parsed = CallToolResultSchema.parse(response);
        const result = parsed.content;
        this.debugLog(() => `Called tool ${toolName} (args: ${JSON.stringify(args)}, result: ${JSON.stringify(result)})`);
        return result;
    }
    get name() {
        return this._name;
    }
    async close() {
        const transport = this.transport;
        if (hasSessionTransport(transport)) {
            const sessionId = transport.sessionId;
            if (sessionId && typeof transport.terminateSession === 'function') {
                try {
                    // Best-effort cleanup: we do not actively manage session lifecycles,
                    // but if the server supports sessions we terminate to avoid leaks.
                    await transport.terminateSession();
                }
                catch (error) {
                    this.logger.warn('Failed to terminate MCP session:', error);
                }
            }
        }
        if (transport) {
            await transport.close();
            this.transport = null;
        }
        if (this.session) {
            await this.session.close();
            this.session = null;
        }
    }
}
exports.NodeMCPServerStreamableHttp = NodeMCPServerStreamableHttp;
//# sourceMappingURL=node.js.map