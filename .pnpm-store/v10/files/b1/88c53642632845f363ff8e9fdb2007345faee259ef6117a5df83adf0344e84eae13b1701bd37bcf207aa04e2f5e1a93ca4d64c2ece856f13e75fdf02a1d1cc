import { serializeHandoff, serializeTool } from "../utils/serialize.mjs";
import { resolveComputer } from "../tool.mjs";
import { ensureAgentSpan } from "./tracing.mjs";
/**
 * Collects tools and handoffs for the current agent so model calls and tracing share the same
 * snapshot of enabled capabilities.
 */
export async function prepareAgentArtifacts(state) {
    const capabilities = await collectAgentCapabilities(state);
    await warmUpComputerTools(capabilities.tools, state._context);
    state.setCurrentAgentSpan(ensureAgentSpan({
        agent: state._currentAgent,
        handoffs: capabilities.handoffs,
        tools: capabilities.tools,
        currentSpan: state._currentAgentSpan,
    }));
    return {
        ...capabilities,
        serializedHandoffs: capabilities.handoffs.map((handoff) => serializeHandoff(handoff)),
        serializedTools: capabilities.tools.map((tool) => serializeTool(tool)),
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
        await resolveComputer({ tool, runContext });
    }));
}
//# sourceMappingURL=modelPreparation.mjs.map