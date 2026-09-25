import { collectAuthDiagnostics } from "@langwatch/api/rest";
import type { LogOtlpDoorResult } from "@langwatch/log-contract";
import { createLogger } from "@langwatch/observability";
import {
  applyReceiverProvenance,
  canonicalOtlpPath,
  decodeOtlpBody,
  ingestDoorRefusalStatus,
  isIngestDoorRefusal,
  logCorrectedOtlpPath,
  otlpBodyForensics,
  parseOtlpLogs,
  type OtlpDoorRequest,
} from "@langwatch/otlp";
import {
  DEFAULT_PII_REDACTION_LEVEL,
  type OtlpIngestCredential,
  type TraceApi,
} from "@langwatch/trace-contract";
import { SpanKind, SpanStatusCode, type Span } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { LogRequestCollectionService } from "./log-request-collection.service.ts";

const CANONICAL_LOGS_PATH = "/api/otel/v1/logs";

/** Trace's share of the door: the key, the allowance, the key's clock and the failure report. */
export type LogReceiverTraceSlice = Pick<
  TraceApi,
  "otlpCredential" | "otlpUsageLimit" | "otlpMarkCredentialUsed" | "otlpReportError"
>;

export interface OtlpLogReceiverDeps {
  traces: LogReceiverTraceSlice;
  collection: Pick<LogRequestCollectionService, "handleOtlpLogRequest">;
}

/** `POST /api/otel/v1/logs`, moved one-to-one from Trace's receiver (main: routes/otel.ts). */
export class OtlpLogReceiverService {
  readonly #tracer = getLangWatchTracer("langwatch.otel.logs");
  readonly #logger = createLogger("langwatch:otel:v1:logs");
  readonly #deps: OtlpLogReceiverDeps;

  private constructor(deps: OtlpLogReceiverDeps) {
    this.#deps = deps;
  }

  static create(deps: OtlpLogReceiverDeps): OtlpLogReceiverService {
    return new OtlpLogReceiverService(deps);
  }

  receive(request: OtlpDoorRequest): Promise<LogOtlpDoorResult> {
    if (canonicalOtlpPath(request.path) !== CANONICAL_LOGS_PATH) {
      return Promise.resolve({ outcome: "not-found" });
    }

    return this.#tracer.withActiveSpan(
      "[POST] /api/otel/v1/logs",
      { kind: SpanKind.SERVER },
      (span) => this.#receive({ request, span }),
    );
  }

  async #receive({
    request,
    span,
  }: {
    request: OtlpDoorRequest;
    span: Span;
  }): Promise<LogOtlpDoorResult> {
    const { traces, collection } = this.#deps;
    const header = (name: string): string | undefined => request.headers[name];

    let credential: OtlpIngestCredential;
    try {
      credential = await traces.otlpCredential({
        authorization: header("authorization") ?? null,
        xAuthToken: header("x-auth-token") ?? null,
        xProjectId: header("x-project-id") ?? null,
      });
    } catch (error) {
      if (!isIngestDoorRefusal(error)) throw error;

      const diagnostics = collectAuthDiagnostics({
        path: request.path,
        method: request.method,
        header,
      });
      this.#logger.warn(
        { ...diagnostics, refusalStatus: ingestDoorRefusalStatus(error) },
        diagnostics.hasEmptyAuthToken
          ? "Authentication failed: X-Auth-Token sent but empty"
          : "Authentication failed",
      );
      span.setStatus({ code: SpanStatusCode.ERROR, message: "unauthenticated" });
      return { outcome: "refused", refusal: error };
    }

    const { project, identity } = credential;
    logCorrectedOtlpPath({
      originalPath: request.path,
      canonicalPath: CANONICAL_LOGS_PATH,
      projectId: project.id,
      logger: this.#logger,
    });
    span.setAttribute("langwatch.project.id", project.id);

    await traces.otlpUsageLimit({ project, customerTraceIds: [] });

    const body = await decodeOtlpBody(request.body, header("content-encoding") ?? null);
    const parsed = parseOtlpLogs(body, header("content-type"));
    if (!parsed.ok) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: "Failed to parse logs" });
      span.recordException(new Error(parsed.error));
      this.#logger.error(
        { error: parsed.error, projectId: project.id, ...otlpBodyForensics(body) },
        "error parsing logs",
      );
      traces.otlpReportError(new Error(parsed.error), {
        projectId: project.id,
        customerTraceIds: [],
      });
      return { outcome: "parse-failed" };
    }

    if (identity.apiKeyId) traces.otlpMarkCredentialUsed({ apiKeyId: identity.apiKeyId });

    applyReceiverProvenance({
      request: parsed.request,
      identity,
      signal: "logs",
      logger: this.#logger,
    });

    return collection.handleOtlpLogRequest({
      tenantId: project.id,
      organizationId: project.organizationId,
      logRequest: parsed.request,
      piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
    });
  }
}
