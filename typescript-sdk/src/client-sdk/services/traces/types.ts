import type { paths } from "@/internal/generated/openapi/api-client";
import { BaseRequestOptions } from "@/client-sdk/types";

export interface GetTraceParams {
  includeSpans?: boolean;
}

export type GetTraceResponse = NonNullable<
  paths["/api/trace/{id}"]["get"]["responses"]["200"]["content"]["application/json"]
>;

/**
 * Custom error class for Traces API operations.
 * Provides context about the failed operation and the original error.
 */
export class TracesError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: any,
  ) {
    super(message);
    this.name = "TracesError";
  }
}
