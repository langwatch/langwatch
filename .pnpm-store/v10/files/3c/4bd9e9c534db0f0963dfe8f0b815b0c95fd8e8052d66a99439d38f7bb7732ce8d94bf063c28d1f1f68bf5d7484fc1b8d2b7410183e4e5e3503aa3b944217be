"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoopSpan = exports.Span = void 0;
const logger_1 = __importDefault(require("../logger.js"));
const utils_1 = require("./utils.js");
class Span {
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
        this.#spanId = options.spanId ?? (0, utils_1.generateSpanId)();
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
            logger_1.default.warn('Span already started');
            return;
        }
        this.#startedAt = (0, utils_1.timeIso)();
        this.#processor.onSpanStart(this);
    }
    end() {
        if (this.#endedAt) {
            logger_1.default.debug('Span already finished', this.spanData);
            return;
        }
        this.#endedAt = (0, utils_1.timeIso)();
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
            span_data: (0, utils_1.removePrivateFields)(this.spanData),
            error: this.error,
        };
    }
}
exports.Span = Span;
class NoopSpan extends Span {
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
exports.NoopSpan = NoopSpan;
//# sourceMappingURL=spans.js.map