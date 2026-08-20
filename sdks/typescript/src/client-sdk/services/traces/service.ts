import { createTracingProxy } from "@/client-sdk/tracing/create-tracing-proxy";
import type { InternalConfig } from "@/client-sdk/types";
import { tracer } from "./tracing";
import {
  type GetTraceParams,
  type GetTraceResponse,
  TracesError,
} from "./types";

/**
 * Service for managing trace resources via the Langwatch API.
 * Constructor creates a proxy that wraps the service and traces all methods.
 *
 * Responsibilities:
 * - Retrieving trace data
 * - Error handling with contextual information
 *
 * All methods return trace response objects directly.
 */
export class TracesService {
  private config: InternalConfig;

  constructor(config: InternalConfig) {
    this.config = config;

    /**
     * Wraps the service in a tracing proxy via the decorator.
     */
    // biome-ignore lint/correctness/noConstructorReturn: the proxy substitution is the pattern -- callers must get the instrumented proxy back, not `this`.
    return createTracingProxy(this as TracesService, tracer);
  }

  /**
   * Handles API errors by throwing a TracesError with operation context.
   * @param operation Description of the operation being performed.
   * @param error The error object returned from the API client.
   * @throws {TracesError}
   */
  private handleApiError(operation: string, error: any): never {
    const errorMessage =
      typeof error === "string"
        ? error
        : (error?.error ?? error?.message ?? "Unknown error occurred");
    const message = `Failed to ${operation}: ${errorMessage}`;

    throw new TracesError(message, operation, error);
  }

  /**
   * Retrieves a trace by its ID.
   * @param traceId The trace's unique identifier.
   * @param params Optional parameters for the request.
   * @returns The trace response object.
   * @throws {TracesError} If the API call fails.
   */
  async get(
    traceId: string,
    params?: GetTraceParams,
  ): Promise<GetTraceResponse> {
    const { data, error } = await this.config.langwatchApiClient.GET(
      "/api/trace/{id}",
      {
        params: {
          path: {
            id: traceId,
          },
        },
        query: params,
      },
    );

    if (error) {
      this.handleApiError("get trace", error);
    }

    return data;
  }
}
