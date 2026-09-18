"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.computerTool = computerTool;
exports.resolveComputer = resolveComputer;
exports.disposeResolvedComputers = disposeResolvedComputers;
exports.shellTool = shellTool;
exports.applyPatchTool = applyPatchTool;
exports.hostedMcpTool = hostedMcpTool;
exports.tool = tool;
const safeExecute_1 = require("./utils/safeExecute.js");
const tools_1 = require("./utils/tools.js");
const tools_2 = require("./utils/tools.js");
const typeGuards_1 = require("./utils/typeGuards.js");
const errors_1 = require("./errors.js");
const logger_1 = __importDefault(require("./logger.js"));
const tracing_1 = require("./tracing/index.js");
const smartString_1 = require("./utils/smartString.js");
const toolGuardrail_1 = require("./toolGuardrail.js");
function isComputerProvider(candidate) {
    return (!!candidate &&
        typeof candidate === 'object' &&
        typeof candidate.create === 'function');
}
/**
 * Exposes a computer to the agent as a tool to be called.
 *
 * @param options Additional configuration for the computer tool like specifying the location of your agent
 * @returns a computer tool definition
 */
function computerTool(options) {
    if (!options.computer) {
        throw new errors_1.UserError('computerTool requires a computer instance or an initializer function.');
    }
    const tool = {
        type: 'computer',
        name: options.name ?? 'computer_use_preview',
        computer: options.computer,
    };
    if (typeof options.computer === 'function' ||
        isComputerProvider(options.computer)) {
        computerInitializerMap.set(tool, options.computer);
    }
    return tool;
}
// Keeps per-tool cache of computer instances keyed by RunContext so each run gets its own instance.
const computerCache = new WeakMap();
// Tracks the initializer so we do not overwrite the callable on the tool when we memoize the resolved instance.
const computerInitializerMap = new WeakMap();
// Allows cleanup routines to find all resolved computer instances for a given run context.
const computersByRunContext = new WeakMap();
function getComputerInitializer(tool) {
    const initializer = computerInitializerMap.get(tool);
    if (initializer) {
        return initializer;
    }
    if (typeof tool.computer === 'function' ||
        isComputerProvider(tool.computer)) {
        return tool.computer;
    }
    return undefined;
}
function trackResolvedComputer(tool, runContext, resolved) {
    let resolvedByRun = computersByRunContext.get(runContext);
    if (!resolvedByRun) {
        resolvedByRun = new Map();
        computersByRunContext.set(runContext, resolvedByRun);
    }
    resolvedByRun.set(tool, resolved);
}
/**
 * Returns a computer instance for the provided run context. Caches per run to avoid sharing across runs.
 * @internal
 */
async function resolveComputer(args) {
    const { tool, runContext } = args;
    // Cache instances per RunContext so a single Computer is not shared across simultaneous runs.
    const toolKey = tool;
    let perContext = computerCache.get(toolKey);
    if (!perContext) {
        perContext = new WeakMap();
        computerCache.set(toolKey, perContext);
    }
    const cached = perContext.get(runContext);
    if (cached) {
        trackResolvedComputer(tool, runContext, cached);
        return cached.computer;
    }
    const initializerConfig = getComputerInitializer(tool);
    const lifecycle = initializerConfig && isComputerProvider(initializerConfig)
        ? initializerConfig
        : isComputerProvider(tool.computer)
            ? tool.computer
            : undefined;
    const initializer = typeof initializerConfig === 'function'
        ? initializerConfig
        : (lifecycle?.create ??
            (typeof tool.computer === 'function'
                ? tool.computer
                : undefined));
    const disposer = lifecycle?.dispose;
    const computer = initializer && typeof initializer === 'function'
        ? await initializer({ runContext })
        : tool.computer;
    if (!computer) {
        throw new errors_1.UserError('The computer tool did not provide a computer instance.');
    }
    const resolved = {
        computer,
        dispose: disposer,
    };
    perContext.set(runContext, resolved);
    trackResolvedComputer(tool, runContext, resolved);
    tool.computer = computer;
    return computer;
}
/**
 * Disposes any computer instances created for the provided run context.
 * @internal
 */
async function disposeResolvedComputers({ runContext, }) {
    const resolvedByRun = computersByRunContext.get(runContext);
    if (!resolvedByRun) {
        return;
    }
    computersByRunContext.delete(runContext);
    const disposers = [];
    for (const [tool, resolved] of resolvedByRun.entries()) {
        const perContext = computerCache.get(tool);
        perContext?.delete(runContext);
        const storedInitializer = getComputerInitializer(tool);
        if (storedInitializer) {
            tool.computer = storedInitializer;
        }
        if (resolved.dispose) {
            disposers.push(async () => {
                await resolved.dispose?.({ runContext, computer: resolved.computer });
            });
        }
    }
    for (const dispose of disposers) {
        try {
            await dispose();
        }
        catch (error) {
            logger_1.default.warn(`Failed to dispose computer for run context: ${error}`);
        }
    }
}
function shellTool(options) {
    const needsApproval = typeof options.needsApproval === 'function'
        ? options.needsApproval
        : async () => typeof options.needsApproval === 'boolean'
            ? options.needsApproval
            : false;
    return {
        type: 'shell',
        name: options.name ?? 'shell',
        shell: options.shell,
        needsApproval,
        onApproval: options.onApproval,
    };
}
function applyPatchTool(options) {
    const needsApproval = typeof options.needsApproval === 'function'
        ? options.needsApproval
        : async () => typeof options.needsApproval === 'boolean'
            ? options.needsApproval
            : false;
    return {
        type: 'apply_patch',
        name: options.name ?? 'apply_patch',
        editor: options.editor,
        needsApproval,
        onApproval: options.onApproval,
    };
}
/**
 * Creates a hosted MCP tool definition.
 *
 * @param options - Configuration for the hosted MCP tool, including server connection details
 * and approval requirements.
 */
function hostedMcpTool(options) {
    if ('serverUrl' in options) {
        // the MCP servers comaptible with the specification
        const providerData = typeof options.requireApproval === 'undefined' ||
            options.requireApproval === 'never'
            ? {
                type: 'mcp',
                server_label: options.serverLabel,
                server_url: options.serverUrl,
                authorization: options.authorization,
                require_approval: 'never',
                allowed_tools: toMcpAllowedToolsFilter(options.allowedTools),
                headers: options.headers,
            }
            : {
                type: 'mcp',
                server_label: options.serverLabel,
                server_url: options.serverUrl,
                authorization: options.authorization,
                allowed_tools: toMcpAllowedToolsFilter(options.allowedTools),
                headers: options.headers,
                require_approval: typeof options.requireApproval === 'string'
                    ? 'always'
                    : buildRequireApproval(options.requireApproval),
                on_approval: options.onApproval,
            };
        return {
            type: 'hosted_tool',
            name: 'hosted_mcp',
            providerData,
        };
    }
    else if ('connectorId' in options) {
        // OpenAI's connectors
        const providerData = typeof options.requireApproval === 'undefined' ||
            options.requireApproval === 'never'
            ? {
                type: 'mcp',
                server_label: options.serverLabel,
                connector_id: options.connectorId,
                authorization: options.authorization,
                require_approval: 'never',
                allowed_tools: toMcpAllowedToolsFilter(options.allowedTools),
                headers: options.headers,
            }
            : {
                type: 'mcp',
                server_label: options.serverLabel,
                connector_id: options.connectorId,
                authorization: options.authorization,
                allowed_tools: toMcpAllowedToolsFilter(options.allowedTools),
                headers: options.headers,
                require_approval: typeof options.requireApproval === 'string'
                    ? 'always'
                    : buildRequireApproval(options.requireApproval),
                on_approval: options.onApproval,
            };
        return {
            type: 'hosted_tool',
            name: 'hosted_mcp',
            providerData,
        };
    }
    else {
        // the MCP servers comaptible with the specification
        const providerData = typeof options.requireApproval === 'undefined' ||
            options.requireApproval === 'never'
            ? {
                type: 'mcp',
                server_label: options.serverLabel,
                require_approval: 'never',
                allowed_tools: toMcpAllowedToolsFilter(options.allowedTools),
            }
            : {
                type: 'mcp',
                server_label: options.serverLabel,
                allowed_tools: toMcpAllowedToolsFilter(options.allowedTools),
                require_approval: typeof options.requireApproval === 'string'
                    ? 'always'
                    : buildRequireApproval(options.requireApproval),
                on_approval: options.onApproval,
            };
        return {
            type: 'hosted_tool',
            name: 'hosted_mcp',
            providerData,
        };
    }
}
/**
 * The default function to invoke when an error occurs while running the tool.
 *
 * Always returns `An error occurred while running the tool. Please try again. Error: <error details>`
 *
 * @param context An instance of the current RunContext
 * @param error The error that occurred
 */
function defaultToolErrorFunction(context, error) {
    const details = error instanceof Error ? error.toString() : String(error);
    return `An error occurred while running the tool. Please try again. Error: ${details}`;
}
/**
 * Exposes a function to the agent as a tool to be called
 *
 * @param options The options for the tool
 * @returns A new tool
 */
function tool(options) {
    const name = options.name
        ? (0, tools_1.toFunctionToolName)(options.name)
        : (0, tools_1.toFunctionToolName)(options.execute.name);
    const toolErrorFunction = typeof options.errorFunction === 'undefined'
        ? defaultToolErrorFunction
        : options.errorFunction;
    if (!name) {
        throw new Error('Tool name cannot be empty. Either name your function or provide a name in the options.');
    }
    const strictMode = options.strict ?? true;
    if (!strictMode && (0, typeGuards_1.isZodObject)(options.parameters)) {
        throw new errors_1.UserError('Strict mode is required for Zod parameters');
    }
    const { parser, schema: parameters } = (0, tools_2.getSchemaAndParserFromInputType)(options.parameters, name);
    async function _invoke(runContext, input, details) {
        const [error, parsed] = await (0, safeExecute_1.safeExecute)(() => parser(input));
        if (error !== null) {
            if (logger_1.default.dontLogToolData) {
                logger_1.default.debug(`Invalid JSON input for tool ${name}`);
            }
            else {
                logger_1.default.debug(`Invalid JSON input for tool ${name}: ${input}`);
            }
            // supply the same context as options.execute for consuming
            // downstream code to implement self-healing and/or tracing
            throw new errors_1.InvalidToolInputError('Invalid JSON input for tool', undefined, // no RunState available in this context
            error, { runContext, input, details });
        }
        if (logger_1.default.dontLogToolData) {
            logger_1.default.debug(`Invoking tool ${name}`);
        }
        else {
            logger_1.default.debug(`Invoking tool ${name} with input ${input}`);
        }
        const result = await options.execute(parsed, runContext, details);
        const stringResult = (0, smartString_1.toSmartString)(result);
        if (logger_1.default.dontLogToolData) {
            logger_1.default.debug(`Tool ${name} completed`);
        }
        else {
            logger_1.default.debug(`Tool ${name} returned: ${stringResult}`);
        }
        return result;
    }
    async function invoke(runContext, input, details) {
        return _invoke(runContext, input, details).catch((error) => {
            if (toolErrorFunction) {
                const currentSpan = (0, tracing_1.getCurrentSpan)();
                currentSpan?.setError({
                    message: 'Error running tool (non-fatal)',
                    data: {
                        tool_name: name,
                        error: error.toString(),
                    },
                });
                return toolErrorFunction(runContext, error);
            }
            throw error;
        });
    }
    const needsApproval = typeof options.needsApproval === 'function'
        ? options.needsApproval
        : async () => typeof options.needsApproval === 'boolean'
            ? options.needsApproval
            : false;
    const isEnabled = typeof options.isEnabled === 'function'
        ? async (runContext, agent) => {
            const predicate = options.isEnabled;
            const result = await predicate({ runContext, agent });
            return Boolean(result);
        }
        : async () => typeof options.isEnabled === 'boolean' ? options.isEnabled : true;
    return {
        type: 'function',
        name,
        description: options.description,
        parameters,
        strict: strictMode,
        invoke,
        needsApproval,
        isEnabled,
        inputGuardrails: (0, toolGuardrail_1.resolveToolInputGuardrails)(options.inputGuardrails),
        outputGuardrails: (0, toolGuardrail_1.resolveToolOutputGuardrails)(options.outputGuardrails),
    };
}
function buildRequireApproval(requireApproval) {
    const result = {};
    if (requireApproval.always) {
        result.always = { tool_names: requireApproval.always.toolNames };
    }
    if (requireApproval.never) {
        result.never = { tool_names: requireApproval.never.toolNames };
    }
    return result;
}
function toMcpAllowedToolsFilter(allowedTools) {
    if (typeof allowedTools === 'undefined') {
        return undefined;
    }
    if (Array.isArray(allowedTools)) {
        return { tool_names: allowedTools };
    }
    return { tool_names: allowedTools?.toolNames ?? [] };
}
//# sourceMappingURL=tool.js.map