import { createTracingProxy } from "@/client-sdk/tracing/create-tracing-proxy";

import { type InternalConfig } from "../../types";
import { TracesApiService } from "./traces-api.service";
import { tracer } from "./tracing";
import { type GetTraceParams, type GetTraceResponse } from "./types";

/** `langwatch.traces`: the CLI's trace read, traced. Failures throw `TracesApiError`. */
export class TracesFacade {
  readonly #service: TracesApiService;

  constructor(config: InternalConfig) {
    this.#service = createTracingProxy(new TracesApiService(config), tracer);
  }

  /** `params` stays for compatibility; the endpoint takes no such option and never got one. */
  async get(traceId: string, _params?: GetTraceParams): Promise<GetTraceResponse> {
    const trace: GetTraceResponse = {};
    // The served schema is free-form; the hand-declared shape is asserted here, as before.
    return Object.assign(trace, await this.#service.get(traceId));
  }
}
