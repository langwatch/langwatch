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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateTraceId = exports.generateSpanId = exports.generateGroupId = exports.Trace = exports.NoopTrace = exports.Span = exports.NoopSpan = exports.ConsoleSpanExporter = exports.BatchTraceProcessor = exports.withTrace = exports.setCurrentSpan = exports.resetCurrentSpan = exports.getOrCreateTrace = exports.getCurrentTrace = exports.getCurrentSpan = void 0;
exports.addTraceProcessor = addTraceProcessor;
exports.setTraceProcessors = setTraceProcessors;
exports.setTracingDisabled = setTracingDisabled;
exports.startTraceExportLoop = startTraceExportLoop;
const provider_1 = require("./provider.js");
var context_1 = require("./context.js");
Object.defineProperty(exports, "getCurrentSpan", { enumerable: true, get: function () { return context_1.getCurrentSpan; } });
Object.defineProperty(exports, "getCurrentTrace", { enumerable: true, get: function () { return context_1.getCurrentTrace; } });
Object.defineProperty(exports, "getOrCreateTrace", { enumerable: true, get: function () { return context_1.getOrCreateTrace; } });
Object.defineProperty(exports, "resetCurrentSpan", { enumerable: true, get: function () { return context_1.resetCurrentSpan; } });
Object.defineProperty(exports, "setCurrentSpan", { enumerable: true, get: function () { return context_1.setCurrentSpan; } });
Object.defineProperty(exports, "withTrace", { enumerable: true, get: function () { return context_1.withTrace; } });
__exportStar(require("./createSpans.js"), exports);
var processor_1 = require("./processor.js");
Object.defineProperty(exports, "BatchTraceProcessor", { enumerable: true, get: function () { return processor_1.BatchTraceProcessor; } });
Object.defineProperty(exports, "ConsoleSpanExporter", { enumerable: true, get: function () { return processor_1.ConsoleSpanExporter; } });
var spans_1 = require("./spans.js");
Object.defineProperty(exports, "NoopSpan", { enumerable: true, get: function () { return spans_1.NoopSpan; } });
Object.defineProperty(exports, "Span", { enumerable: true, get: function () { return spans_1.Span; } });
var traces_1 = require("./traces.js");
Object.defineProperty(exports, "NoopTrace", { enumerable: true, get: function () { return traces_1.NoopTrace; } });
Object.defineProperty(exports, "Trace", { enumerable: true, get: function () { return traces_1.Trace; } });
var utils_1 = require("./utils.js");
Object.defineProperty(exports, "generateGroupId", { enumerable: true, get: function () { return utils_1.generateGroupId; } });
Object.defineProperty(exports, "generateSpanId", { enumerable: true, get: function () { return utils_1.generateSpanId; } });
Object.defineProperty(exports, "generateTraceId", { enumerable: true, get: function () { return utils_1.generateTraceId; } });
/**
 * Add a processor to the list of processors. Each processor will receive all traces/spans.
 *
 * @param processor - The processor to add.
 */
function addTraceProcessor(processor) {
    (0, provider_1.getGlobalTraceProvider)().registerProcessor(processor);
}
/**
 * Set the list of processors. This will replace any existing processors.
 *
 * @param processors - The list of processors to set.
 */
function setTraceProcessors(processors) {
    (0, provider_1.getGlobalTraceProvider)().setProcessors(processors);
}
/**
 * Set the disabled state of the tracing provider.
 *
 * @param disabled - Whether to disable tracing.
 */
function setTracingDisabled(disabled) {
    (0, provider_1.getGlobalTraceProvider)().setDisabled(disabled);
}
/**
 * Start the trace export loop.
 */
function startTraceExportLoop() {
    (0, provider_1.getGlobalTraceProvider)().startExportLoop();
}
//# sourceMappingURL=index.js.map