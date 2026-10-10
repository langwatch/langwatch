import type { LogOtlpDoorResult } from "@langwatch/log-contract";
import { canonicalOtlpPath, createLogger } from "@langwatch/observability";
import {
  applyReceiverProvenance,
  decodeOtlpBody,
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
import { SpanKind, type Span } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { LogRequestCollectionService } from "./log-request-collection.service.ts";

const CANONICAL_LOGS_PATH = "/api/otel/v1/logs";

/** Trace's share of the receiver: the allowance and the key's clock. */
type LogReceiverTraceSlice = Pick<TraceApi, "otlpUsageLimit" | "otlpMarkCredentialUsed">;

interface OtlpLogReceiverDeps {
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

  /** `credential` is the key the `otlp_ingest` door already verified, before the body. */
  receive({
    request,
    credential,
  }: {
    request: OtlpDoorRequest;
    credential: OtlpIngestCredential;
  }): Promise<LogOtlpDoorResult> {
    if (canonicalOtlpPath(request.path) !== CANONICAL_LOGS_PATH) {
      return Promise.resolve({ outcome: "not-found" });
    }

    return this.#tracer.withActiveSpan(
      "[POST] /api/otel/v1/logs",
      { kind: SpanKind.SERVER },
      (span) => this.#receive({ request, credential, span }),
    );
  }

  async #receive({
    request,
    credential,
    span,
  }: {
    request: OtlpDoorRequest;
    credential: OtlpIngestCredential;
    span: Span;
  }): Promise<LogOtlpDoorResult> {
    const { traces, collection } = this.#deps;
    const header = (name: string): string | undefined => request.headers[name];

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
      // The client's fault (specs/otlp/client-parse-failures.feature): warn, no
      // exception, span status left UNSET as for any customer fault.
      span.setAttributes({
        "langwatch.error.fault": "customer",
        "langwatch.otel.parse_error": parsed.error,
      });
      this.#logger.warn(
        {
          handledErrorFault: "customer",
          error: parsed.error,
          projectId: project.id,
          ...otlpBodyForensics(body),
        },
        "error parsing logs",
      );
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
