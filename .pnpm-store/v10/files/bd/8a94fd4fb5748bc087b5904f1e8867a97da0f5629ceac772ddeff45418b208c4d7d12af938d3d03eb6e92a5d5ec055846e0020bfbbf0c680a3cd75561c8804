"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiTracingProcessor = exports.BatchTraceProcessor = exports.ConsoleSpanExporter = void 0;
exports.defaultExporter = defaultExporter;
exports.defaultProcessor = defaultProcessor;
const logger_1 = __importDefault(require("../logger.js"));
const _shims_1 = require("@openai/agents-core/_shims");
const config_1 = require("../config.js");
/**
 * Prints the traces and spans to the console
 */
class ConsoleSpanExporter {
    async export(items) {
        if (config_1.tracing.disabled) {
            logger_1.default.debug('Tracing is disabled. Skipping export');
            return;
        }
        for (const item of items) {
            if (item.type === 'trace') {
                console.log(`[Exporter] Export trace traceId=${item.traceId} name=${item.name}${item.groupId ? ` groupId=${item.groupId}` : ''}`);
            }
            else {
                console.log(`[Exporter] Export span: ${JSON.stringify(item)}`);
            }
        }
    }
}
exports.ConsoleSpanExporter = ConsoleSpanExporter;
class BatchTraceProcessor {
    #maxQueueSize;
    #maxBatchSize;
    #scheduleDelay;
    #exportTriggerSize;
    #exporter;
    #buffer = [];
    #timer;
    #timeout = null;
    #exportInProgress = false;
    #timeoutAbortController = null;
    constructor(exporter, { maxQueueSize = 1000, maxBatchSize = 100, scheduleDelay = 5000, // 5 seconds
    exportTriggerRatio = 0.8, } = {}) {
        this.#maxQueueSize = maxQueueSize;
        this.#maxBatchSize = maxBatchSize;
        this.#scheduleDelay = scheduleDelay;
        this.#exportTriggerSize = maxQueueSize * exportTriggerRatio;
        this.#exporter = exporter;
        this.#timer = _shims_1.timer;
        if ((0, _shims_1.isTracingLoopRunningByDefault)()) {
            this.start();
        }
        else {
            logger_1.default.debug('Automatic trace export loop is not supported in this environment. You need to manually call `getGlobalTraceProvider().forceFlush()` to export traces.');
        }
    }
    start() {
        this.#timeoutAbortController = new AbortController();
        this.#runExportLoop();
    }
    async #safeAddItem(item) {
        if (this.#buffer.length + 1 > this.#maxQueueSize) {
            logger_1.default.error('Dropping trace because buffer is full');
            return;
        }
        // add the item to the buffer
        this.#buffer.push(item);
        if (this.#buffer.length > this.#exportTriggerSize) {
            // start exporting immediately
            await this.#exportBatches();
        }
    }
    #runExportLoop() {
        this.#timeout = this.#timer.setTimeout(async () => {
            // scheduled export
            await this.#exportBatches();
            this.#runExportLoop();
        }, this.#scheduleDelay);
        // We set this so that Node no longer considers this part of the event loop and keeps the
        // process alive until the timer is done.
        if (typeof this.#timeout.unref === 'function') {
            this.#timeout.unref();
        }
    }
    async #exportBatches(force = false) {
        if (this.#buffer.length === 0) {
            return;
        }
        logger_1.default.debug(`Exporting batches. Force: ${force}. Buffer size: ${this.#buffer.length}`);
        if (force || this.#buffer.length < this.#maxBatchSize) {
            const toExport = [...this.#buffer];
            this.#buffer = [];
            this.#exportInProgress = true;
            await this.#exporter.export(toExport);
            this.#exportInProgress = false;
        }
        else if (this.#buffer.length > 0) {
            const batch = this.#buffer.splice(0, this.#maxBatchSize);
            this.#exportInProgress = true;
            await this.#exporter.export(batch);
            this.#exportInProgress = false;
        }
    }
    async onTraceStart(trace) {
        await this.#safeAddItem(trace);
    }
    async onTraceEnd(_trace) {
        // We don't send traces on end because we already send them on start
    }
    async onSpanStart(_span) {
        // We don't send spans on start because we send them at the end
    }
    async onSpanEnd(span) {
        await this.#safeAddItem(span);
    }
    async shutdown(timeout) {
        if (timeout) {
            this.#timer.setTimeout(() => {
                // force shutdown the HTTP request
                this.#timeoutAbortController?.abort();
            }, timeout);
        }
        logger_1.default.debug('Shutting down gracefully');
        while (this.#buffer.length > 0) {
            logger_1.default.debug(`Waiting for buffer to empty. Items left: ${this.#buffer.length}`);
            if (!this.#exportInProgress) {
                // no current export in progress. Forcing all items to be exported
                await this.#exportBatches(true);
            }
            if (this.#timeoutAbortController?.signal.aborted) {
                logger_1.default.debug('Timeout reached, force flushing');
                await this.#exportBatches(true);
                break;
            }
            // using setTimeout to add to the event loop and keep this alive until done
            await new Promise((resolve) => this.#timer.setTimeout(resolve, 500));
        }
        logger_1.default.debug('Buffer empty. Exiting');
        if (this.#timer && this.#timeout) {
            // making sure there are no more requests
            this.#timer.clearTimeout(this.#timeout);
        }
    }
    async forceFlush() {
        if (this.#buffer.length > 0) {
            await this.#exportBatches(true);
        }
    }
}
exports.BatchTraceProcessor = BatchTraceProcessor;
class MultiTracingProcessor {
    #processors = [];
    start() {
        for (const processor of this.#processors) {
            if (processor.start) {
                processor.start();
            }
        }
    }
    addTraceProcessor(processor) {
        this.#processors.push(processor);
    }
    setProcessors(processors) {
        logger_1.default.debug('Shutting down old processors');
        for (const processor of this.#processors) {
            processor.shutdown();
        }
        this.#processors = processors;
    }
    async onTraceStart(trace) {
        for (const processor of this.#processors) {
            await processor.onTraceStart(trace);
        }
    }
    async onTraceEnd(trace) {
        for (const processor of this.#processors) {
            await processor.onTraceEnd(trace);
        }
    }
    async onSpanStart(span) {
        for (const processor of this.#processors) {
            await processor.onSpanStart(span);
        }
    }
    async onSpanEnd(span) {
        for (const processor of this.#processors) {
            await processor.onSpanEnd(span);
        }
    }
    async shutdown(timeout) {
        for (const processor of this.#processors) {
            await processor.shutdown(timeout);
        }
    }
    async forceFlush() {
        for (const processor of this.#processors) {
            await processor.forceFlush();
        }
    }
}
exports.MultiTracingProcessor = MultiTracingProcessor;
let _defaultExporter = null;
let _defaultProcessor = null;
function defaultExporter() {
    if (!_defaultExporter) {
        _defaultExporter = new ConsoleSpanExporter();
    }
    return _defaultExporter;
}
function defaultProcessor() {
    if (!_defaultProcessor) {
        _defaultProcessor = new BatchTraceProcessor(defaultExporter());
    }
    return _defaultProcessor;
}
//# sourceMappingURL=processor.js.map