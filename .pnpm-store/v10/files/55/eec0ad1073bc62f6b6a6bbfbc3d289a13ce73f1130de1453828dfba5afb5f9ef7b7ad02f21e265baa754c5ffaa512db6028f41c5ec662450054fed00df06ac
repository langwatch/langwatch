"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withMCPListToolsSpan = exports.withSpeechGroupSpan = exports.withSpeechSpan = exports.withTranscriptionSpan = exports.withGuardrailSpan = exports.withCustomSpan = exports.withGenerationSpan = exports.withHandoffSpan = exports.withFunctionSpan = exports.withAgentSpan = exports.withResponseSpan = void 0;
exports.createResponseSpan = createResponseSpan;
exports.createAgentSpan = createAgentSpan;
exports.createFunctionSpan = createFunctionSpan;
exports.createHandoffSpan = createHandoffSpan;
exports.createGenerationSpan = createGenerationSpan;
exports.createCustomSpan = createCustomSpan;
exports.createGuardrailSpan = createGuardrailSpan;
exports.createTranscriptionSpan = createTranscriptionSpan;
exports.createSpeechSpan = createSpeechSpan;
exports.createSpeechGroupSpan = createSpeechGroupSpan;
exports.createMCPListToolsSpan = createMCPListToolsSpan;
const context_1 = require("./context.js");
const provider_1 = require("./provider.js");
function _withSpanFactory(createSpan) {
    return async (fn, ...args) => {
        // Creating a new span context to make sure that the previous span is correctly reset
        return (0, context_1.withNewSpanContext)(async () => {
            const span = createSpan(...args);
            (0, context_1.setCurrentSpan)(span);
            try {
                span.start();
                return await fn(span);
            }
            catch (error) {
                span.setError({
                    message: error.message,
                    data: error.data,
                });
                throw error;
            }
            finally {
                span.end();
                (0, context_1.resetCurrentSpan)();
            }
        });
    };
}
/**
 * Create a new response span. The span will not be started automatically, you should either
 * use `withResponseSpan()` or call `span.start()` and `span.end()` manually.
 *
 * This span captures the details of a model response, primarily the response identifier.
 * If you need to capture detailed generation information such as input/output messages,
 * model configuration, or usage data, use `createGenerationSpan()` instead.
 *
 * @param options - Optional span creation options, including span data and identifiers.
 * @param parent - The parent span or trace. If not provided, the current trace/span will be used
 * automatically.
 *
 * @returns The newly created response span.
 */
function createResponseSpan(options, parent) {
    options = {};
    return (0, provider_1.getGlobalTraceProvider)().createSpan({
        ...options,
        data: {
            type: 'response',
            ...options.data,
        },
    }, parent);
}
/**
 * Create a new response span and automatically start and end it.
 *
 * This span captures the details of a model response, primarily the response identifier.
 * If you need to capture detailed generation information such as input/output messages,
 * model configuration, or usage data, use `generationSpan()` instead.
 */
exports.withResponseSpan = _withSpanFactory(createResponseSpan);
/**
 * Create a new agent span. The span will not be started automatically, you should either
 * use `withAgentSpan()` or call `span.start()` and `span.end()` manually.
 *
 * @param options - Optional span creation options, including span data and identifiers.
 * @param parent - The parent span or trace. If not provided, the current trace/span will be used
 * automatically.
 *
 * @returns The newly created agent span.
 */
function createAgentSpan(options, parent) {
    return (0, provider_1.getGlobalTraceProvider)().createSpan({
        ...options,
        data: {
            type: 'agent',
            name: options?.data?.name ?? 'Agent',
            ...options?.data,
        },
    }, parent);
}
/**
 * Create a new agent span and automatically start and end it.
 */
exports.withAgentSpan = _withSpanFactory(createAgentSpan);
/**
 * Create a new function span. The span will not be started automatically, you should either
 * use `withFunctionSpan()` or call `span.start()` and `span.end()` manually.
 *
 * @param options - Optional span creation options, including span data and identifiers.
 * @param parent - The parent span or trace. If not provided, the current trace/span will be used
 * automatically.
 *
 * @returns The newly created function span.
 */
function createFunctionSpan(options, parent) {
    return (0, provider_1.getGlobalTraceProvider)().createSpan({
        ...options,
        data: {
            type: 'function',
            input: options?.data?.input ?? '',
            output: options?.data?.output ?? '',
            ...options?.data,
        },
    }, parent);
}
/**
 * Create a new function span and automatically start and end it.
 */
exports.withFunctionSpan = _withSpanFactory(createFunctionSpan);
/**
 * Create a new handoff span. The span will not be started automatically, you should either
 * use `withHandoffSpan()` or call `span.start()` and `span.end()` manually.
 *
 * @param options - Optional span creation options, including span data and identifiers.
 * @param parent - The parent span or trace. If not provided, the current trace/span will be used
 * automatically.
 *
 * @returns The newly created handoff span.
 */
function createHandoffSpan(options, parent) {
    return (0, provider_1.getGlobalTraceProvider)().createSpan({
        ...options,
        data: { type: 'handoff', ...options?.data },
    }, parent);
}
/**
 * Create a new handoff span and automatically start and end it.
 */
exports.withHandoffSpan = _withSpanFactory(createHandoffSpan);
/**
 * Create a new generation span. The span will not be started automatically, you should either
 * use `withGenerationSpan()` or call `span.start()` and `span.end()` manually.
 *
 * This span captures the details of a model generation, including input/output message
 * sequences, model information, and usage data. If you only need to capture a model response
 * identifier, consider using `createResponseSpan()` instead.
 */
function createGenerationSpan(options, parent) {
    return (0, provider_1.getGlobalTraceProvider)().createSpan({
        ...options,
        data: {
            type: 'generation',
            ...options?.data,
        },
    }, parent);
}
/** Automatically create a generation span, run fn and close the span */
exports.withGenerationSpan = _withSpanFactory(createGenerationSpan);
/**
 * Create a new custom span. The span will not be started automatically, you should either use
 * `withCustomSpan()` or call `span.start()` and `span.end()` manually.
 */
function createCustomSpan(options, parent) {
    return (0, provider_1.getGlobalTraceProvider)().createSpan({
        ...options,
        data: {
            type: 'custom',
            data: {},
            ...options?.data,
        },
    }, parent);
}
exports.withCustomSpan = _withSpanFactory(createCustomSpan);
/**
 * Create a new guardrail span. The span will not be started automatically, you should either use
 * `withGuardrailSpan()` or call `span.start()` and `span.end()` manually.
 */
function createGuardrailSpan(options, parent) {
    return (0, provider_1.getGlobalTraceProvider)().createSpan({
        ...options,
        data: {
            type: 'guardrail',
            triggered: false,
            ...options?.data,
        },
    }, parent);
}
exports.withGuardrailSpan = _withSpanFactory(createGuardrailSpan);
/**
 * Create a new transcription span. The span will not be started automatically.
 */
function createTranscriptionSpan(options, parent) {
    return (0, provider_1.getGlobalTraceProvider)().createSpan({
        ...options,
        data: {
            type: 'transcription',
            ...options.data,
        },
    }, parent);
}
exports.withTranscriptionSpan = _withSpanFactory(createTranscriptionSpan);
/**
 * Create a new speech span. The span will not be started automatically.
 */
function createSpeechSpan(options, parent) {
    return (0, provider_1.getGlobalTraceProvider)().createSpan({
        ...options,
        data: {
            type: 'speech',
            ...options.data,
        },
    }, parent);
}
exports.withSpeechSpan = _withSpanFactory(createSpeechSpan);
/**
 * Create a new speech group span. The span will not be started automatically.
 */
function createSpeechGroupSpan(options, parent) {
    return (0, provider_1.getGlobalTraceProvider)().createSpan({
        ...options,
        data: {
            type: 'speech_group',
            ...options?.data,
        },
    }, parent);
}
exports.withSpeechGroupSpan = _withSpanFactory(createSpeechGroupSpan);
/**
 * Create a new MCP list tools span. The span will not be started automatically.
 */
function createMCPListToolsSpan(options, parent) {
    return (0, provider_1.getGlobalTraceProvider)().createSpan({
        ...options,
        data: {
            type: 'mcp_tools',
            ...options?.data,
        },
    }, parent);
}
exports.withMCPListToolsSpan = _withSpanFactory(createMCPListToolsSpan);
//# sourceMappingURL=createSpans.js.map