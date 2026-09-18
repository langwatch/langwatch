"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareAgentArtifacts = prepareAgentArtifacts;
const serialize_1 = require("../utils/serialize.js");
const tool_1 = require("../tool.js");
const tracing_1 = require("./tracing.js");
/**
 * Collects tools and handoffs for the current agent so model calls and tracing share the same
 * snapshot of enabled capabilities.
 */
async function prepareAgentArtifacts(state) {
    const capabilities = await collectAgentCapabilities(state);
    await warmUpComputerTools(capabilities.tools, state._context);
    state.setCurrentAgentSpan((0, tracing_1.ensureAgentSpan)({
        agent: state._currentAgent,
        handoffs: capabilities.handoffs,
        tools: capabilities.tools,
        currentSpan: state._currentAgentSpan,
    }));
    return {
        ...capabilities,
        serializedHandoffs: capabilities.handoffs.map((handoff) => (0, serialize_1.serializeHandoff)(handoff)),
        serializedTools: capabilities.tools.map((tool) => (0, serialize_1.serializeTool)(tool)),
        toolsExplicitlyProvided: state._currentAgent.hasExplicitToolConfig(),
    };
}
async function collectAgentCapabilities(state) {
    const handoffs = await state._currentAgent.getEnabledHandoffs(state._context);
    const tools = (await state._currentAgent.getAllTools(state._context));
    return { handoffs, tools };
}
async function warmUpComputerTools(tools, runContext) {
    const computerTools = tools.filter((tool) => tool.type === 'computer');
    if (computerTools.length === 0) {
        return;
    }
    await Promise.all(computerTools.map(async (tool) => {
        await (0, tool_1.resolveComputer)({ tool, runContext });
    }));
}
//# sourceMappingURL=modelPreparation.js.map