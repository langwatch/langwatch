"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientTools = void 0;
const events_1 = require("./events");
/**
 * Handles registration and execution of client-side tools that can be called by the agent.
 *
 * Supports both synchronous and asynchronous tools running in a dedicated event loop,
 * ensuring non-blocking operation of the main conversation thread.
 */
class ClientTools {
    constructor() {
        this.tools = new Map();
    }
    /**
     * Register a new tool that can be called by the AI agent.
     *
     * @param toolName Unique identifier for the tool
     * @param handler Function that implements the tool's logic
     * @param isAsync Whether the handler is an async function (auto-detected if not specified)
     */
    register(toolName, handler, isAsync) {
        if (!handler || typeof handler !== "function") {
            throw new Error("Handler must be a function");
        }
        if (this.tools.has(toolName)) {
            throw new Error(`Tool '${toolName}' is already registered`);
        }
        // Auto-detect if the function is async if not specified
        const isAsyncHandler = isAsync !== undefined ? isAsync : handler.constructor.name === "AsyncFunction";
        this.tools.set(toolName, {
            handler,
            isAsync: isAsyncHandler,
        });
    }
    /**
     * Execute a registered tool with the given parameters.
     *
     * @param toolName Name of the tool to execute
     * @param parameters Parameters to pass to the tool
     * @returns The result of the tool execution
     */
    handle(toolName, parameters) {
        return __awaiter(this, void 0, void 0, function* () {
            const tool = this.tools.get(toolName);
            if (!tool) {
                throw new Error(`Tool '${toolName}' is not registered`);
            }
            if (tool.isAsync) {
                return yield tool.handler(parameters);
            }
            else {
                return tool.handler(parameters);
            }
        });
    }
    /**
     * Execute a tool and send its result via the provided callback.
     *
     * This method is non-blocking and handles both sync and async tools.
     *
     * @param toolName Name of the tool to execute
     * @param parameters Parameters to pass to the tool (should include tool_call_id)
     * @param callback Function to call with the result
     */
    executeToolAsync(toolName, parameters, callback) {
        // Run the tool execution in the next tick to avoid blocking
        setImmediate(() => __awaiter(this, void 0, void 0, function* () {
            try {
                const result = yield this.handle(toolName, parameters);
                const response = {
                    type: events_1.ClientToOrchestratorEvent.CLIENT_TOOL_RESULT,
                    tool_call_id: parameters.tool_call_id,
                    result: result !== null && result !== void 0 ? result : `Client tool: ${toolName} called successfully.`,
                    is_error: false,
                };
                callback(response);
            }
            catch (error) {
                const response = {
                    type: events_1.ClientToOrchestratorEvent.CLIENT_TOOL_RESULT,
                    tool_call_id: parameters.tool_call_id,
                    result: error.message || String(error),
                    is_error: true,
                };
                callback(response);
            }
        }));
    }
    /**
     * Get a list of all registered tool names.
     *
     * @returns Array of tool names
     */
    getRegisteredTools() {
        return Array.from(this.tools.keys());
    }
    /**
     * Check if a tool is registered.
     *
     * @param toolName Name of the tool to check
     * @returns True if the tool is registered
     */
    isToolRegistered(toolName) {
        return this.tools.has(toolName);
    }
    /**
     * Unregister a tool.
     *
     * @param toolName Name of the tool to unregister
     * @returns True if the tool was found and removed
     */
    unregister(toolName) {
        return this.tools.delete(toolName);
    }
    /**
     * Clear all registered tools.
     */
    clear() {
        this.tools.clear();
    }
}
exports.ClientTools = ClientTools;
