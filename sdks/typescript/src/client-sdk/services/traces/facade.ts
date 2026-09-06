import { type InternalConfig } from "../../types";
import { TracesService } from "./service";
import { type GetTraceParams, type GetTraceResponse } from "./types";

export class TracesFacade {
  readonly #service: TracesService;

  constructor(config: InternalConfig) {
    this.#service = new TracesService(config);
  }

  async get(traceId: string, params?: GetTraceParams): Promise<GetTraceResponse> {
    return this.#service.get(traceId, params);
  }
}
