import type { MetricOtlpDoorResult } from "@langwatch/metric-contract";
import { canonicalOtlpPath, createLogger } from "@langwatch/observability";
import {
  applyReceiverProvenance,
  decodeOtlpBody,
  logCorrectedOtlpPath,
  otlpBodyForensics,
  parseOtlpMetrics,
  type OtlpDoorRequest,
} from "@langwatch/otlp";
import {
  DEFAULT_PII_REDACTION_LEVEL,
  type OtlpIngestCredential,
  type TraceApi,
} from "@langwatch/trace-contract";
import { SpanKind, type Span } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { MetricRequestCollectionService } from "./metric-request-collection.service.ts";

const CANONICAL_METRICS_PATH = "/api/otel/v1/metrics";

/** Trace's share of the receiver: the allowance and the key's clock. */
type MetricReceiverTraceSlice = Pick<TraceApi, "otlpUsageLimit" | "otlpMarkCredentialUsed">;

interface OtlpMetricReceiverDeps {
  traces: MetricReceiverTraceSlice;
  collection: Pick<MetricRequestCollectionService, "handleOtlpMetricRequest">;
}

/** `POST /api/otel/v1/metrics`, moved one-to-one from Trace's receiver (main: routes/otel.ts). */
export class OtlpMetricReceiverService {
  readonly #tracer = getLangWatchTracer("langwatch.otel.metrics");
  readonly #logger = createLogger("langwatch:otel:v1:metrics");
  readonly #deps: OtlpMetricReceiverDeps;

  private constructor(deps: OtlpMetricReceiverDeps) {
    this.#deps = deps;
  }

  static create(deps: OtlpMetricReceiverDeps): OtlpMetricReceiverService {
    return new OtlpMetricReceiverService(deps);
  }

  /** `credential` is the key the `otlp_ingest` door already verified, before the body. */
  receive({
    request,
    credential,
  }: {
    request: OtlpDoorRequest;
    credential: OtlpIngestCredential;
  }): Promise<MetricOtlpDoorResult> {
    if (canonicalOtlpPath(request.path) !== CANONICAL_METRICS_PATH) {
      return Promise.resolve({ outcome: "not-found" });
    }

    return this.#tracer.withActiveSpan(
      "[POST] /api/otel/v1/metrics",
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
  }): Promise<MetricOtlpDoorResult> {
    const { traces, collection } = this.#deps;
    const header = (name: string): string | undefined => request.headers[name];

    const { project, identity } = credential;
    logCorrectedOtlpPath({
      originalPath: request.path,
      canonicalPath: CANONICAL_METRICS_PATH,
      projectId: project.id,
      logger: this.#logger,
    });
    span.setAttribute("langwatch.project.id", project.id);

    await traces.otlpUsageLimit({ project, customerTraceIds: [] });

    const body = await decodeOtlpBody(request.body, header("content-encoding") ?? null);
    const parsed = parseOtlpMetrics(body, header("content-type"));
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
        "error parsing metrics",
      );
      return { outcome: "parse-failed" };
    }

    applyReceiverProvenance({
      request: parsed.request,
      identity,
      signal: "metrics",
      logger: this.#logger,
    });

    if (identity.apiKeyId) traces.otlpMarkCredentialUsed({ apiKeyId: identity.apiKeyId });

    return collection.handleOtlpMetricRequest({
      tenantId: project.id,
      organizationId: project.organizationId,
      metricRequest: parsed.request,
      piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
    });
  }
}
