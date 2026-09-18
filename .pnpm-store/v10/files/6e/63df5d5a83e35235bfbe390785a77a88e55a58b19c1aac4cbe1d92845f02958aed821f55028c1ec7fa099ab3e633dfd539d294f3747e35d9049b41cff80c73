import { defaultProcessor } from "./processor.mjs";
import { generateTraceId } from "./utils.mjs";
export class Trace {
    type = 'trace';
    traceId;
    name;
    groupId = null;
    metadata;
    tracingApiKey;
    #processor;
    #started;
    constructor(options, processor) {
        this.traceId = options.traceId ?? generateTraceId();
        this.name = options.name ?? 'Agent workflow';
        this.groupId = options.groupId ?? null;
        this.metadata = options.metadata ?? {};
        this.tracingApiKey = options.tracingApiKey;
        this.#processor = processor ?? defaultProcessor();
        this.#started = options.started ?? false;
    }
    async start() {
        if (this.#started) {
            return;
        }
        this.#started = true;
        await this.#processor.onTraceStart(this);
    }
    async end() {
        if (!this.#started) {
            return;
        }
        this.#started = false;
        await this.#processor.onTraceEnd(this);
    }
    clone() {
        return new Trace({
            traceId: this.traceId,
            name: this.name,
            groupId: this.groupId ?? undefined,
            metadata: this.metadata,
            started: this.#started,
            tracingApiKey: this.tracingApiKey,
        });
    }
    /**
     * Serializes the trace for export or persistence.
     * Set `includeTracingApiKey` to true only when you intentionally need to persist the
     * exporter credentials (for example, when handing off a run to another process that
     * cannot access the original environment). Defaults to false to avoid leaking secrets.
     */
    toJSON(options) {
        const base = {
            object: this.type,
            id: this.traceId,
            workflow_name: this.name,
            group_id: this.groupId,
            metadata: this.metadata,
        };
        if (options?.includeTracingApiKey && this.tracingApiKey) {
            base.tracing_api_key = this.tracingApiKey;
        }
        return base;
    }
}
export class NoopTrace extends Trace {
    constructor() {
        super({});
    }
    async start() {
        return;
    }
    async end() {
        return;
    }
    toJSON() {
        return null;
    }
}
//# sourceMappingURL=traces.mjs.map