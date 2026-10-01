import { type ExportResult } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { type ReadableSpan } from "@opentelemetry/sdk-trace-base";

import { buildAuthHeaders } from "../../internal/api/auth";
import {
  DEFAULT_ENDPOINT,
  LANGWATCH_SDK_LANGUAGE,
  LANGWATCH_SDK_NAME_OBSERVABILITY,
  LANGWATCH_SDK_RUNTIME,
  LANGWATCH_SDK_VERSION,
  TRACES_PATH,
} from "../../internal/constants";
import { type TraceFilter, type Criteria, type Match, applyFilters } from "./trace-filters";

/** Options: endpoint URL, API key for auth, and optional span filters (default excludes HTTP). */
export interface LangWatchTraceExporterOptions {
  endpoint?: string;
  apiKey?: string;
  /**
   * Project identifier. Required when `apiKey` is a Personal Access Token
   * (`pat-lw-*`); ignored for legacy `sk-lw-*` keys. Falls back to
   * `LANGWATCH_PROJECT_ID`.
   */
  projectId?: string;
  filters?: TraceFilter[] | null;
}

export type { TraceFilter, Criteria, Match };

/** Sends traces to LangWatch with auth; applies span filters (default excludes HTTP). */
export class LangWatchTraceExporter extends OTLPTraceExporter {
  private readonly filters: TraceFilter[];
  /** Configures auth from opts or environment; applies filters to span stream. */
  constructor(opts?: LangWatchTraceExporterOptions) {
    const apiKey = opts?.apiKey ?? process.env.LANGWATCH_API_KEY ?? "";
    const projectId = opts?.projectId ?? process.env.LANGWATCH_PROJECT_ID;
    const endpoint = opts?.endpoint ?? process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT;

    const url = new URL(TRACES_PATH, endpoint);
    const otelEndpoint = url.toString();

    super({
      headers: {
        "x-langwatch-sdk-name": LANGWATCH_SDK_NAME_OBSERVABILITY,
        "x-langwatch-sdk-language": LANGWATCH_SDK_LANGUAGE,
        "x-langwatch-sdk-version": LANGWATCH_SDK_VERSION,
        "x-langwatch-sdk-runtime": LANGWATCH_SDK_RUNTIME(),
        ...buildAuthHeaders({ apiKey, projectId }),
      },
      url: otelEndpoint.toString(),
    });

    // Handle filters: null or [] = no filtering, undefined = default, array = use provided
    if (opts?.filters === null || (Array.isArray(opts?.filters) && opts.filters.length === 0)) {
      this.filters = [];
    } else if (Array.isArray(opts?.filters)) {
      this.filters = opts.filters;
    } else {
      this.filters = [{ preset: "excludeHttpRequests" }];
    }
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const filtered = applyFilters(this.filters, spans);
    super.export(filtered, resultCallback);
  }
}
