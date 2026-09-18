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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDefaultModel = exports.gpt5ReasoningSettingsRequired = exports.OPENAI_DEFAULT_MODEL_ENV_VARIABLE_NAME = exports.createMCPToolStaticFilter = exports.MCPServerSSE = exports.MCPServerStreamableHttp = exports.MCPServerStdio = exports.mcpToFunctionTool = exports.invalidateServerToolsCache = exports.getAllMcpTools = exports.applyDiff = exports.getLogger = exports.AgentHooks = exports.RunToolCallOutputItem = exports.RunToolCallItem = exports.RunToolApprovalItem = exports.RunReasoningItem = exports.RunMessageOutputItem = exports.RunHandoffOutputItem = exports.RunHandoffCallItem = exports.extractAllTextOutput = exports.user = exports.system = exports.assistant = exports.handoff = exports.Handoff = exports.getTransferMessage = exports.getHandoff = exports.resolveToolOutputGuardrails = exports.resolveToolInputGuardrails = exports.defineToolOutputGuardrail = exports.defineToolInputGuardrail = exports.ToolGuardrailFunctionOutputFactory = exports.defineOutputGuardrail = exports.RunItemStreamEvent = exports.RunRawModelStreamEvent = exports.RunAgentUpdatedStreamEvent = exports.SystemError = exports.UserError = exports.ToolCallError = exports.ToolOutputGuardrailTripwireTriggered = exports.ToolInputGuardrailTripwireTriggered = exports.OutputGuardrailTripwireTriggered = exports.ModelBehaviorError = exports.MaxTurnsExceededError = exports.InputGuardrailTripwireTriggered = exports.GuardrailExecutionError = exports.AgentsError = exports.Agent = exports.RuntimeEventEmitter = void 0;
exports.protocol = exports.MemorySession = exports.isOpenAIResponsesCompactionAwareSession = exports.Usage = exports.RequestUsage = exports.runToolOutputGuardrails = exports.runToolInputGuardrails = exports.TraceProvider = exports.getGlobalTraceProvider = exports.tool = exports.hostedMcpTool = exports.applyPatchTool = exports.shellTool = exports.computerTool = exports.RunState = exports.RunContext = exports.Runner = exports.run = exports.StreamedRunResult = exports.RunResult = exports.setDefaultModelProvider = exports.isGpt5Default = exports.getDefaultModelSettings = void 0;
const tracing_1 = require("./tracing/index.js");
const processor_1 = require("./tracing/processor.js");
var _shims_1 = require("@openai/agents-core/_shims");
Object.defineProperty(exports, "RuntimeEventEmitter", { enumerable: true, get: function () { return _shims_1.RuntimeEventEmitter; } });
var agent_1 = require("./agent.js");
Object.defineProperty(exports, "Agent", { enumerable: true, get: function () { return agent_1.Agent; } });
var errors_1 = require("./errors.js");
Object.defineProperty(exports, "AgentsError", { enumerable: true, get: function () { return errors_1.AgentsError; } });
Object.defineProperty(exports, "GuardrailExecutionError", { enumerable: true, get: function () { return errors_1.GuardrailExecutionError; } });
Object.defineProperty(exports, "InputGuardrailTripwireTriggered", { enumerable: true, get: function () { return errors_1.InputGuardrailTripwireTriggered; } });
Object.defineProperty(exports, "MaxTurnsExceededError", { enumerable: true, get: function () { return errors_1.MaxTurnsExceededError; } });
Object.defineProperty(exports, "ModelBehaviorError", { enumerable: true, get: function () { return errors_1.ModelBehaviorError; } });
Object.defineProperty(exports, "OutputGuardrailTripwireTriggered", { enumerable: true, get: function () { return errors_1.OutputGuardrailTripwireTriggered; } });
Object.defineProperty(exports, "ToolInputGuardrailTripwireTriggered", { enumerable: true, get: function () { return errors_1.ToolInputGuardrailTripwireTriggered; } });
Object.defineProperty(exports, "ToolOutputGuardrailTripwireTriggered", { enumerable: true, get: function () { return errors_1.ToolOutputGuardrailTripwireTriggered; } });
Object.defineProperty(exports, "ToolCallError", { enumerable: true, get: function () { return errors_1.ToolCallError; } });
Object.defineProperty(exports, "UserError", { enumerable: true, get: function () { return errors_1.UserError; } });
Object.defineProperty(exports, "SystemError", { enumerable: true, get: function () { return errors_1.SystemError; } });
var events_1 = require("./events.js");
Object.defineProperty(exports, "RunAgentUpdatedStreamEvent", { enumerable: true, get: function () { return events_1.RunAgentUpdatedStreamEvent; } });
Object.defineProperty(exports, "RunRawModelStreamEvent", { enumerable: true, get: function () { return events_1.RunRawModelStreamEvent; } });
Object.defineProperty(exports, "RunItemStreamEvent", { enumerable: true, get: function () { return events_1.RunItemStreamEvent; } });
var guardrail_1 = require("./guardrail.js");
Object.defineProperty(exports, "defineOutputGuardrail", { enumerable: true, get: function () { return guardrail_1.defineOutputGuardrail; } });
var toolGuardrail_1 = require("./toolGuardrail.js");
Object.defineProperty(exports, "ToolGuardrailFunctionOutputFactory", { enumerable: true, get: function () { return toolGuardrail_1.ToolGuardrailFunctionOutputFactory; } });
Object.defineProperty(exports, "defineToolInputGuardrail", { enumerable: true, get: function () { return toolGuardrail_1.defineToolInputGuardrail; } });
Object.defineProperty(exports, "defineToolOutputGuardrail", { enumerable: true, get: function () { return toolGuardrail_1.defineToolOutputGuardrail; } });
Object.defineProperty(exports, "resolveToolInputGuardrails", { enumerable: true, get: function () { return toolGuardrail_1.resolveToolInputGuardrails; } });
Object.defineProperty(exports, "resolveToolOutputGuardrails", { enumerable: true, get: function () { return toolGuardrail_1.resolveToolOutputGuardrails; } });
var handoff_1 = require("./handoff.js");
Object.defineProperty(exports, "getHandoff", { enumerable: true, get: function () { return handoff_1.getHandoff; } });
Object.defineProperty(exports, "getTransferMessage", { enumerable: true, get: function () { return handoff_1.getTransferMessage; } });
Object.defineProperty(exports, "Handoff", { enumerable: true, get: function () { return handoff_1.Handoff; } });
Object.defineProperty(exports, "handoff", { enumerable: true, get: function () { return handoff_1.handoff; } });
var message_1 = require("./helpers/message.js");
Object.defineProperty(exports, "assistant", { enumerable: true, get: function () { return message_1.assistant; } });
Object.defineProperty(exports, "system", { enumerable: true, get: function () { return message_1.system; } });
Object.defineProperty(exports, "user", { enumerable: true, get: function () { return message_1.user; } });
var items_1 = require("./items.js");
Object.defineProperty(exports, "extractAllTextOutput", { enumerable: true, get: function () { return items_1.extractAllTextOutput; } });
Object.defineProperty(exports, "RunHandoffCallItem", { enumerable: true, get: function () { return items_1.RunHandoffCallItem; } });
Object.defineProperty(exports, "RunHandoffOutputItem", { enumerable: true, get: function () { return items_1.RunHandoffOutputItem; } });
Object.defineProperty(exports, "RunMessageOutputItem", { enumerable: true, get: function () { return items_1.RunMessageOutputItem; } });
Object.defineProperty(exports, "RunReasoningItem", { enumerable: true, get: function () { return items_1.RunReasoningItem; } });
Object.defineProperty(exports, "RunToolApprovalItem", { enumerable: true, get: function () { return items_1.RunToolApprovalItem; } });
Object.defineProperty(exports, "RunToolCallItem", { enumerable: true, get: function () { return items_1.RunToolCallItem; } });
Object.defineProperty(exports, "RunToolCallOutputItem", { enumerable: true, get: function () { return items_1.RunToolCallOutputItem; } });
var lifecycle_1 = require("./lifecycle.js");
Object.defineProperty(exports, "AgentHooks", { enumerable: true, get: function () { return lifecycle_1.AgentHooks; } });
var logger_1 = require("./logger.js");
Object.defineProperty(exports, "getLogger", { enumerable: true, get: function () { return logger_1.getLogger; } });
var applyDiff_1 = require("./utils/applyDiff.js");
Object.defineProperty(exports, "applyDiff", { enumerable: true, get: function () { return applyDiff_1.applyDiff; } });
var mcp_1 = require("./mcp.js");
Object.defineProperty(exports, "getAllMcpTools", { enumerable: true, get: function () { return mcp_1.getAllMcpTools; } });
Object.defineProperty(exports, "invalidateServerToolsCache", { enumerable: true, get: function () { return mcp_1.invalidateServerToolsCache; } });
Object.defineProperty(exports, "mcpToFunctionTool", { enumerable: true, get: function () { return mcp_1.mcpToFunctionTool; } });
Object.defineProperty(exports, "MCPServerStdio", { enumerable: true, get: function () { return mcp_1.MCPServerStdio; } });
Object.defineProperty(exports, "MCPServerStreamableHttp", { enumerable: true, get: function () { return mcp_1.MCPServerStreamableHttp; } });
Object.defineProperty(exports, "MCPServerSSE", { enumerable: true, get: function () { return mcp_1.MCPServerSSE; } });
var mcpUtil_1 = require("./mcpUtil.js");
Object.defineProperty(exports, "createMCPToolStaticFilter", { enumerable: true, get: function () { return mcpUtil_1.createMCPToolStaticFilter; } });
var defaultModel_1 = require("./defaultModel.js");
Object.defineProperty(exports, "OPENAI_DEFAULT_MODEL_ENV_VARIABLE_NAME", { enumerable: true, get: function () { return defaultModel_1.OPENAI_DEFAULT_MODEL_ENV_VARIABLE_NAME; } });
Object.defineProperty(exports, "gpt5ReasoningSettingsRequired", { enumerable: true, get: function () { return defaultModel_1.gpt5ReasoningSettingsRequired; } });
Object.defineProperty(exports, "getDefaultModel", { enumerable: true, get: function () { return defaultModel_1.getDefaultModel; } });
Object.defineProperty(exports, "getDefaultModelSettings", { enumerable: true, get: function () { return defaultModel_1.getDefaultModelSettings; } });
Object.defineProperty(exports, "isGpt5Default", { enumerable: true, get: function () { return defaultModel_1.isGpt5Default; } });
var providers_1 = require("./providers.js");
Object.defineProperty(exports, "setDefaultModelProvider", { enumerable: true, get: function () { return providers_1.setDefaultModelProvider; } });
var result_1 = require("./result.js");
Object.defineProperty(exports, "RunResult", { enumerable: true, get: function () { return result_1.RunResult; } });
Object.defineProperty(exports, "StreamedRunResult", { enumerable: true, get: function () { return result_1.StreamedRunResult; } });
var run_1 = require("./run.js");
Object.defineProperty(exports, "run", { enumerable: true, get: function () { return run_1.run; } });
Object.defineProperty(exports, "Runner", { enumerable: true, get: function () { return run_1.Runner; } });
var runContext_1 = require("./runContext.js");
Object.defineProperty(exports, "RunContext", { enumerable: true, get: function () { return runContext_1.RunContext; } });
var runState_1 = require("./runState.js");
Object.defineProperty(exports, "RunState", { enumerable: true, get: function () { return runState_1.RunState; } });
var tool_1 = require("./tool.js");
Object.defineProperty(exports, "computerTool", { enumerable: true, get: function () { return tool_1.computerTool; } });
Object.defineProperty(exports, "shellTool", { enumerable: true, get: function () { return tool_1.shellTool; } });
Object.defineProperty(exports, "applyPatchTool", { enumerable: true, get: function () { return tool_1.applyPatchTool; } });
Object.defineProperty(exports, "hostedMcpTool", { enumerable: true, get: function () { return tool_1.hostedMcpTool; } });
Object.defineProperty(exports, "tool", { enumerable: true, get: function () { return tool_1.tool; } });
__exportStar(require("./tracing/index.js"), exports);
var provider_1 = require("./tracing/provider.js");
Object.defineProperty(exports, "getGlobalTraceProvider", { enumerable: true, get: function () { return provider_1.getGlobalTraceProvider; } });
Object.defineProperty(exports, "TraceProvider", { enumerable: true, get: function () { return provider_1.TraceProvider; } });
var toolGuardrails_1 = require("./utils/toolGuardrails.js");
Object.defineProperty(exports, "runToolInputGuardrails", { enumerable: true, get: function () { return toolGuardrails_1.runToolInputGuardrails; } });
Object.defineProperty(exports, "runToolOutputGuardrails", { enumerable: true, get: function () { return toolGuardrails_1.runToolOutputGuardrails; } });
var usage_1 = require("./usage.js");
Object.defineProperty(exports, "RequestUsage", { enumerable: true, get: function () { return usage_1.RequestUsage; } });
Object.defineProperty(exports, "Usage", { enumerable: true, get: function () { return usage_1.Usage; } });
var session_1 = require("./memory/session.js");
Object.defineProperty(exports, "isOpenAIResponsesCompactionAwareSession", { enumerable: true, get: function () { return session_1.isOpenAIResponsesCompactionAwareSession; } });
var memorySession_1 = require("./memory/memorySession.js");
Object.defineProperty(exports, "MemorySession", { enumerable: true, get: function () { return memorySession_1.MemorySession; } });
/**
 * Exporting the whole protocol as an object here. This contains both the types
 * and the zod schemas for parsing the protocol.
 */
exports.protocol = __importStar(require("./types/protocol.js"));
/**
 * Add the default processor, which exports traces and spans to the backend in batches. You can
 * change the default behavior by either:
 * 1. calling addTraceProcessor, which adds additional processors, or
 * 2. calling setTraceProcessors, which sets the processors and discards the default one
 */
(0, tracing_1.addTraceProcessor)((0, processor_1.defaultProcessor)());
//# sourceMappingURL=index.js.map