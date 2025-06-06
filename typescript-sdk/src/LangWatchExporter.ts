import {
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import {
  JsonTraceSerializer,
  type ISerializer,
} from "@opentelemetry/otlp-transformer";
import { type ExportResult, ExportResultCode } from "@opentelemetry/core";

export class LangWatchExporter implements SpanExporter {
  private endpoint: string;
  private apiKey: string;
  private includeAllSpans: boolean;
  private debug: boolean;
  private serializer: ISerializer<ReadableSpan[], unknown>;

  constructor(
    params: {
      endpoint?: string;
      apiKey?: string;
      includeAllSpans?: boolean;
      debug?: boolean;
    } = {}
  ) {
    this.endpoint =
      params.endpoint ??
      process.env.LANGWATCH_ENDPOINT ??
      "https://app.langwatch.ai";
    this.apiKey = params.apiKey ?? process.env.LANGWATCH_API_KEY ?? "";
    this.includeAllSpans = params.includeAllSpans ?? false;
    this.debug = params.debug ?? false;
    this.serializer = JsonTraceSerializer;

    if (!this.apiKey) {
      throw new Error("LANGWATCH_API_KEY is not set");
    }
  }

  export(
    allSpans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void
  ): void {
    const spans = allSpans.filter(
      (span) => this.includeAllSpans || this.isAiSdkSpan(span)
    );

    if (spans.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }
    if (this.debug) {
      console.log("[LangWatchExporter] Exporting spans:", spans);
    }

    let body;
    try {
      body = this.serializer.serializeRequest(spans);
    } catch (error) {
      console.error("[LangWatchExporter] Failed to serialize spans:", error);
      resultCallback({ code: ExportResultCode.FAILED });
      return;
    }

    fetch(`${this.endpoint}/api/otel/v1/traces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body,
    })
      .then((response) => {
        if (!response.ok) {
          resultCallback({ code: ExportResultCode.FAILED });
          return;
        }
        resultCallback({ code: ExportResultCode.SUCCESS });
      })
      .catch((error) => {
        console.error("[LangWatchExporter] Failed to export spans:", error);
        resultCallback({
          code: ExportResultCode.FAILED,
          error: error instanceof Error ? error : new Error("Unknown error"),
        });
      });
  }

  private isAiSdkSpan(span: ReadableSpan): boolean {
    return span.instrumentationScope?.name === "ai";
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
