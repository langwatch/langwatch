"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTracing = getTracing;
exports.ensureAgentSpan = ensureAgentSpan;
const context_1 = require("../tracing/context.js");
const tracing_1 = require("../tracing/index.js");
/**
 * Normalizes tracing configuration into the format expected by model providers.
 * Returns `false` to disable tracing, `true` to include full payload data, or
 * `'enabled_without_data'` to omit sensitive content while still emitting spans.
 */
function getTracing(tracingDisabled, traceIncludeSensitiveData) {
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
function ensureAgentSpan(params) {
    const { agent, handoffs, tools, currentSpan } = params;
    const existingSpan = currentSpan;
    if (existingSpan) {
        existingSpan.spanData.tools = tools.map((t) => t.name);
        return existingSpan;
    }
    const handoffNames = handoffs.map((h) => h.agentName);
    const span = (0, tracing_1.createAgentSpan)({
        data: {
            name: agent.name,
            handoffs: handoffNames,
            tools: tools.map((t) => t.name),
            output_type: agent.outputSchemaName,
        },
    });
    span.start();
    (0, context_1.setCurrentSpan)(span);
    return span;
}
//# sourceMappingURL=tracing.js.map