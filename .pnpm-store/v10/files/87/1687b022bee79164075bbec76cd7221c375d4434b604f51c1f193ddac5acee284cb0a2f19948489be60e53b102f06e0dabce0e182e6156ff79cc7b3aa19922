import { setCurrentSpan } from "../tracing/context.mjs";
import { createAgentSpan } from "../tracing/index.mjs";
/**
 * Normalizes tracing configuration into the format expected by model providers.
 * Returns `false` to disable tracing, `true` to include full payload data, or
 * `'enabled_without_data'` to omit sensitive content while still emitting spans.
 */
export function getTracing(tracingDisabled, traceIncludeSensitiveData) {
    if (tracingDisabled) {
        return false;
    }
    if (traceIncludeSensitiveData) {
        return true;
    }
    return 'enabled_without_data';
}
/**
 * Ensures an agent span exists and updates tool metadata if already present.
 * Returns the span so callers can pass it through run state.
 */
export function ensureAgentSpan(params) {
    const { agent, handoffs, tools, currentSpan } = params;
    const existingSpan = currentSpan;
    if (existingSpan) {
        existingSpan.spanData.tools = tools.map((t) => t.name);
        return existingSpan;
    }
    const handoffNames = handoffs.map((h) => h.agentName);
    const span = createAgentSpan({
        data: {
            name: agent.name,
            handoffs: handoffNames,
            tools: tools.map((t) => t.name),
            output_type: agent.outputSchemaName,
        },
    });
    span.start();
    setCurrentSpan(span);
    return span;
}
//# sourceMappingURL=tracing.mjs.map