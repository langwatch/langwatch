"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAITracingExporter = void 0;
exports.setDefaultOpenAITracingExporter = setDefaultOpenAITracingExporter;
const agents_core_1 = require("@openai/agents-core");
const defaults_1 = require("./defaults.js");
const logger_1 = __importDefault(require("./logger.js"));
/**
 * A tracing exporter that exports traces to OpenAI's tracing API.
 */
class OpenAITracingExporter {
    #options;
    constructor(options = {}) {
        this.#options = {
            apiKey: options.apiKey ?? undefined,
            organization: options.organization ?? '',
            project: options.project ?? '',
            endpoint: options.endpoint ?? 'https://api.openai.com/v1/traces/ingest',
            maxRetries: options.maxRetries ?? 3,
            baseDelay: options.baseDelay ?? 1000,
            maxDelay: options.maxDelay ?? 30000,
        };
    }
    async export(items, signal) {
        const defaultApiKey = this.#options.apiKey ?? (0, defaults_1.getTracingExportApiKey)();
        const itemsByKey = new Map();
        for (const item of items) {
            const mapKey = item.tracingApiKey;
            const list = itemsByKey.get(mapKey) ?? [];
            list.push(item);
            itemsByKey.set(mapKey, list);
        }
        for (const [key, groupedItems] of itemsByKey.entries()) {
            // Item-level key wins; fall back to exporter config or environment.
            const apiKey = key ?? defaultApiKey;
            if (!apiKey) {
                logger_1.default.error('No API key provided for OpenAI tracing exporter. Exports will be skipped');
                continue;
            }
            const payloadItems = groupedItems
                .map((entry) => entry.toJSON())
                .filter((item) => !!item);
            const payload = { data: payloadItems };
            let attempts = 0;
            let delay = this.#options.baseDelay;
            while (attempts < this.#options.maxRetries) {
                try {
                    const response = await fetch(this.#options.endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${apiKey}`,
                            'OpenAI-Beta': 'traces=v1',
                            ...defaults_1.HEADERS,
                        },
                        body: JSON.stringify(payload),
                        signal,
                    });
                    if (response.ok) {
                        logger_1.default.debug(`Exported ${payload.data.length} items`);
                        break;
                    }
                    if (response.status >= 400 && response.status < 500) {
                        logger_1.default.error(`[non-fatal] Tracing client error ${response.status}: ${await response.text()}`);
                        break;
                    }
                    logger_1.default.warn(`[non-fatal] Tracing: server error ${response.status}, retrying.`);
                }
                catch (error) {
                    logger_1.default.error('[non-fatal] Tracing: request failed: ', error);
                }
                if (signal?.aborted) {
                    logger_1.default.error('Tracing: request aborted');
                    break;
                }
                const sleepTime = delay + Math.random() * 0.1 * delay; // 10% jitter
                await new Promise((resolve) => setTimeout(resolve, sleepTime));
                delay = Math.min(delay * 2, this.#options.maxDelay);
                attempts++;
            }
            if (attempts >= this.#options.maxRetries) {
                logger_1.default.error(`Tracing: failed to export traces after ${this.#options.maxRetries} attempts`);
            }
        }
    }
}
exports.OpenAITracingExporter = OpenAITracingExporter;
/**
 * Sets the OpenAI Tracing exporter as the default exporter with a BatchTraceProcessor handling the
 * traces
 */
function setDefaultOpenAITracingExporter() {
    const exporter = new OpenAITracingExporter();
    const processor = new agents_core_1.BatchTraceProcessor(exporter);
    (0, agents_core_1.setTraceProcessors)([processor]);
}
//# sourceMappingURL=openaiTracingExporter.js.map