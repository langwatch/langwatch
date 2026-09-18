import { getGlobalTraceProvider } from "./provider.mjs";
export { getCurrentSpan, getCurrentTrace, getOrCreateTrace, resetCurrentSpan, setCurrentSpan, withTrace, } from "./context.mjs";
export * from "./createSpans.mjs";
export { BatchTraceProcessor, ConsoleSpanExporter, } from "./processor.mjs";
export { NoopSpan, Span } from "./spans.mjs";
export { NoopTrace, Trace } from "./traces.mjs";
export { generateGroupId, generateSpanId, generateTraceId } from "./utils.mjs";
/**
 * Add a processor to the list of processors. Each processor will receive all traces/spans.
 *
 * @param processor - The processor to add.
 */
export function addTraceProcessor(processor) {
    getGlobalTraceProvider().registerProcessor(processor);
}
/**
 * Set the list of processors. This will replace any existing processors.
 *
 * @param processors - The list of processors to set.
 */
export function setTraceProcessors(processors) {
    getGlobalTraceProvider().setProcessors(processors);
}
/**
 * Set the disabled state of the tracing provider.
 *
 * @param disabled - Whether to disable tracing.
 */
export function setTracingDisabled(disabled) {
    getGlobalTraceProvider().setDisabled(disabled);
}
/**
 * Start the trace export loop.
 */
export function startTraceExportLoop() {
    getGlobalTraceProvider().startExportLoop();
}
//# sourceMappingURL=index.mjs.map