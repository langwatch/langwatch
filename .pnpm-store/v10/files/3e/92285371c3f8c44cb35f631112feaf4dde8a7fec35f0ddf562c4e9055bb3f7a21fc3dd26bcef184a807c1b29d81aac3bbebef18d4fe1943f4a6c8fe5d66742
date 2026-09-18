import { Agent } from '../agent';
import { Handoff } from '../handoff';
import { ModelTracing } from '../model';
import { Tool } from '../tool';
import { createAgentSpan } from '../tracing';
type EnsureAgentSpanParams<TContext> = {
    agent: Agent<TContext, any>;
    handoffs: Handoff<any, any>[];
    tools: Tool<TContext>[];
    currentSpan?: ReturnType<typeof createAgentSpan>;
};
/**
 * Normalizes tracing configuration into the format expected by model providers.
 * Returns `false` to disable tracing, `true` to include full payload data, or
 * `'enabled_without_data'` to omit sensitive content while still emitting spans.
 */
export declare function getTracing(tracingDisabled: boolean, traceIncludeSensitiveData: boolean): ModelTracing;
/**
 * Ensures an agent span exists and updates tool metadata if already present.
 * Returns the span so callers can pass it through run state.
 */
export declare function ensureAgentSpan<TContext>(params: EnsureAgentSpanParams<TContext>): import("../tracing").Span<import("../tracing").AgentSpanData>;
export {};
