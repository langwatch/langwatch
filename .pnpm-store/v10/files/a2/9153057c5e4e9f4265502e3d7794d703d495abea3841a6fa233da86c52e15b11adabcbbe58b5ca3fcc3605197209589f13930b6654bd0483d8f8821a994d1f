import logger from "../logger.mjs";
import { generateSpanId, removePrivateFields, timeIso } from "./utils.mjs";
export class Span {
    type = 'trace.span';
    #data;
    #traceId;
    #spanId;
    #parentId;
    #processor;
    #startedAt;
    #endedAt;
    #error;
    #tracingApiKey;
    #previousSpan;
    constructor(options, processor) {
        this.#traceId = options.traceId;
        this.#spanId = options.spanId ?? generateSpanId();
        this.#data = options.data;
        this.#processor = processor;
        this.#parentId = options.parentId ?? null;
        this.#error = options.error ?? null;
        this.#startedAt = options.startedAt ?? null;
        this.#endedAt = options.endedAt ?? null;
        this.#tracingApiKey = options.tracingApiKey;
    }
    get traceId() {
        return this.#traceId;
    }
    get spanData() {
        return this.#data;
    }
    get spanId() {
        return this.#spanId;
    }
    get parentId() {
        return this.#parentId;
    }
    get previousSpan() {
        return this.#previousSpan;
    }
    set previousSpan(span) {
        this.#previousSpan = span;
    }
    start() {
        if (this.#startedAt) {
            logger.warn('Span already started');
            return;
        }
        this.#startedAt = timeIso();
        this.#processor.onSpanStart(this);
    }
    end() {
        if (this.#endedAt) {
            logger.debug('Span already finished', this.spanData);
            return;
        }
        this.#endedAt = timeIso();
        this.#processor.onSpanEnd(this);
    }
    setError(error) {
        this.#error = error;
    }
    get error() {
        return this.#error;
    }
    get startedAt() {
        return this.#startedAt;
    }
    get endedAt() {
        return this.#endedAt;
    }
    get tracingApiKey() {
        return this.#tracingApiKey;
    }
    clone() {
        const span = new Span({
            traceId: this.traceId,
            spanId: this.spanId,
            parentId: this.parentId ?? undefined,
            data: this.spanData,
            startedAt: this.#startedAt ?? undefined,
            endedAt: this.#endedAt ?? undefined,
            error: this.#error ?? undefined,
            tracingApiKey: this.#tracingApiKey,
        }, this.#processor);
        span.previousSpan = this.previousSpan?.clone();
        return span;
    }
    toJSON() {
        return {
            object: this.type,
            id: this.spanId,
            trace_id: this.traceId,
            parent_id: this.parentId,
            started_at: this.startedAt,
            ended_at: this.endedAt,
            span_data: removePrivateFields(this.spanData),
            error: this.error,
        };
    }
}
export class NoopSpan extends Span {
    constructor(data, processor) {
        super({ traceId: 'no-op', spanId: 'no-op', data }, processor);
    }
    start() {
        return;
    }
    end() {
        return;
    }
    setError() {
        return;
    }
    toJSON() {
        return null;
    }
}
//# sourceMappingURL=spans.mjs.map