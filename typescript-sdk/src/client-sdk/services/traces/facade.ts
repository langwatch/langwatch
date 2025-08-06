import { trace, Tracer } from "@opentelemetry/api";
import { type InternalConfig } from "../../types";
import { TracesService } from "./service";
import { GetTraceOptions, GetTraceParams, GetTraceResponse } from "./types";

export class TracesFacade {
  readonly #tracer: Tracer = trace.getTracer("langwatch.traces");
  readonly #config: InternalConfig;
  readonly #service: TracesService;

  constructor(config: InternalConfig) {
    this.#config = config;
    this.#service = new TracesService(config);
  }

  async get(traceId: string, params?: GetTraceParams, options?: GetTraceOptions): Promise<GetTraceResponse> {
    return this.#service.get(traceId, params, options);
  }

  static defaultOptions: InternalConfig["traces"] = {};
}
