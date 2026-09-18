import logger from "../logger.mjs";
import { timer as _timer, isTracingLoopRunningByDefault, } from '@openai/agents-core/_shims';
import { tracing } from "../config.mjs";
/**
 * Prints the traces and spans to the console
 */
export class ConsoleSpanExporter {
    async export(items) {
        if (tracing.disabled) {
            logger.debug('Tracing is disabled. Skipping export');
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
export class BatchTraceProcessor {
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
        this.#timer = _timer;
        if (isTracingLoopRunningByDefault()) {
            this.start();
        }
        else {
            logger.debug('Automatic trace export loop is not supported in this environment. You need to manually call `getGlobalTraceProvider().forceFlush()` to export traces.');
        }
    }
    start() {
        this.#timeoutAbortController = new AbortController();
        this.#runExportLoop();
    }
    async #safeAddItem(item) {
        if (this.#buffer.length + 1 > this.#maxQueueSize) {
            logger.error('Dropping trace because buffer is full');
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
        logger.debug(`Exporting batches. Force: ${force}. Buffer size: ${this.#buffer.length}`);
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
        logger.debug('Shutting down gracefully');
        while (this.#buffer.length > 0) {
            logger.debug(`Waiting for buffer to empty. Items left: ${this.#buffer.length}`);
            if (!this.#exportInProgress) {
                // no current export in progress. Forcing all items to be exported
                await this.#exportBatches(true);
            }
            if (this.#timeoutAbortController?.signal.aborted) {
                logger.debug('Timeout reached, force flushing');
                await this.#exportBatches(true);
                break;
            }
            // using setTimeout to add to the event loop and keep this alive until done
            await new Promise((resolve) => this.#timer.setTimeout(resolve, 500));
        }
        logger.debug('Buffer empty. Exiting');
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
export class MultiTracingProcessor {
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
        logger.debug('Shutting down old processors');
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
let _defaultExporter = null;
let _defaultProcessor = null;
export function defaultExporter() {
    if (!_defaultExporter) {
        _defaultExporter = new ConsoleSpanExporter();
    }
    return _defaultExporter;
}
export function defaultProcessor() {
    if (!_defaultProcessor) {
        _defaultProcessor = new BatchTraceProcessor(defaultExporter());
    }
    return _defaultProcessor;
}
//# sourceMappingURL=processor.mjs.map