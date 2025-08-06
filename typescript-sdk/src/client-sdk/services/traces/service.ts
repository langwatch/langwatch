import { InternalConfig } from "../../types";
import { GetTraceOptions, GetTraceParams, GetTraceResponse } from "./types";

export class TracesService {
  readonly #config: InternalConfig;

  constructor(config: InternalConfig) {
    this.#config = config;
  }

  async get(traceId: string, params?: GetTraceParams | undefined, options?: GetTraceOptions): Promise<GetTraceResponse> {
    const { data, error } = await this.#config.langwatchApiClient.GET("/api/trace/{id}", {
      params: {
        path: {
          id: traceId,
        },
      },
    });

    if (error) {
      throw new Error(`Failed to get trace: ${error.message}`);
    }

    return data;
  }
}
