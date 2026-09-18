import { BatchTraceProcessor, setTraceProcessors, } from '@openai/agents-core';
import { getTracingExportApiKey, HEADERS } from "./defaults.mjs";
import logger from "./logger.mjs";
/**
 * A tracing exporter that exports traces to OpenAI's tracing API.
 */
export class OpenAITracingExporter {
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
        const defaultApiKey = this.#options.apiKey ?? getTracingExportApiKey();
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
                logger.error('No API key provided for OpenAI tracing exporter. Exports will be skipped');
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
                            ...HEADERS,
                        },
                        body: JSON.stringify(payload),
                        signal,
                    });
                    if (response.ok) {
                        logger.debug(`Exported ${payload.data.length} items`);
                        break;
                    }
                    if (response.status >= 400 && response.status < 500) {
                        logger.error(`[non-fatal] Tracing client error ${response.status}: ${await response.text()}`);
                        break;
                    }
                    logger.warn(`[non-fatal] Tracing: server error ${response.status}, retrying.`);
                }
                catch (error) {
                    logger.error('[non-fatal] Tracing: request failed: ', error);
                }
                if (signal?.aborted) {
                    logger.error('Tracing: request aborted');
                    break;
                }
                const sleepTime = delay + Math.random() * 0.1 * delay; // 10% jitter
                await new Promise((resolve) => setTimeout(resolve, sleepTime));
                delay = Math.min(delay * 2, this.#options.maxDelay);
                attempts++;
            }
            if (attempts >= this.#options.maxRetries) {
                logger.error(`Tracing: failed to export traces after ${this.#options.maxRetries} attempts`);
            }
        }
    }
}
/**
 * Sets the OpenAI Tracing exporter as the default exporter with a BatchTraceProcessor handling the
 * traces
 */
export function setDefaultOpenAITracingExporter() {
    const exporter = new OpenAITracingExporter();
    const processor = new BatchTraceProcessor(exporter);
    setTraceProcessors([processor]);
}
//# sourceMappingURL=openaiTracingExporter.mjs.map