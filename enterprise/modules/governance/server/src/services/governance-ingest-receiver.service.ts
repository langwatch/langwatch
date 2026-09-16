// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a push-mode IngestionSource payload becomes: origin metadata stamped
 * receiver-authoritatively, the existing trace / log / metric pipelines handed
 * the batch under the organization's hidden governance project, and the cost
 * events inside a log batch priced into the spend ledger.
 */
import {
  type CanonicalCostEvent,
  type GovernanceApi,
  type GovernanceIngestionSource,
} from "@langwatch/enterprise-governance-contract";
import { usdToNanoUsd } from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import {
  applyOtlpReceiverPolicy,
  parseOtlpLogs,
  parseOtlpMetrics,
  parseOtlpTraces,
} from "@langwatch/otlp";
import { nowInstant } from "@langwatch/time";
import type {
  IExportLogsServiceRequest,
  IExportMetricsServiceRequest,
  IExportTraceServiceRequest,
  IKeyValue,
} from "@opentelemetry/otlp-transformer";

import type { GovernanceProjectDirectory } from "../app/governance.members.ts";

const logger = createLogger("langwatch:ingest");

/**
 * The trace pipeline this receiver hands spans to. The redaction level is NOT
 * among its arguments: that is the composition's decision, fixed once where
 * the collection is built, rather than a per-request choice.
 */
export type GovernanceIngestTraceCollection = (input: {
  tenantId: string;
  traceRequest: IExportTraceServiceRequest;
}) => Promise<{ rejectedSpans?: number } | undefined>;

/** The log pipeline the webhook and `/v1/logs` receivers hand records to. */
export type GovernanceIngestLogCollectionChannel = (input: {
  tenantId: string;
  organizationId: string;
  logRequest: IExportLogsServiceRequest;
}) => Promise<unknown>;

/** The metric pipeline `/v1/metrics` hands data points to. */
export type GovernanceIngestMetricCollectionChannel = (input: {
  tenantId: string;
  organizationId: string;
  metricRequest: IExportMetricsServiceRequest;
}) => Promise<
  Readonly<{
    outcome: string;
    errorMessage?: string | undefined;
    rejectedDataPoints: number;
    acceptedDataPoints: number;
  }>
>;

/**
 * The spend ledger and change feed an extracted cost event lands in, or none.
 * All three travel together because one write without the others is worse than
 * none: a debit row nobody evicts a cache for is spend the gateway keeps
 * routing against a stale balance.
 */
export type GovernanceIngestSpend = Readonly<{
  insertDebit: (rows: readonly Record<string, unknown>[]) => Promise<unknown>;
  resolveApplicableBudgets: (scopes: {
    organizationId: string;
    teamId: string;
    projectId: string;
    virtualKeyId: string;
    principalUserId: string | null;
  }) => Promise<
    readonly {
      budget: Readonly<{ id: string; scopeType: string; scopeId: string; window: string }>;
    }[]
  >;
  appendChange: (input: {
    organizationId: string;
    projectId: string;
    kind: string;
    payload: Record<string, unknown>;
  }) => Promise<unknown>;
}>;

/**
 * The principal resolution a priced cost event performs, stated as the one
 * method it needs rather than as the repository that answers it.
 */
export type GovernanceIngestPrincipalDirectory = Readonly<{
  findMemberIdByEmail(input: { email: string; organizationId: string }): Promise<string | null>;
}>;

/**
 * One batch as it arrives. `read` decompresses the wire body and is called
 * inside the receiver's own guard, because a body we will never be able to
 * read is acknowledged with a hint rather than retried forever.
 */
export type GovernanceIngestBatch = Readonly<{
  source: GovernanceIngestionSource;
  read: () => Promise<ArrayBuffer>;
  contentType: string | undefined;
}>;

export type GovernanceIngestTraceReceipt =
  | Readonly<{ outcome: "wrong-endpoint" }>
  | Readonly<{
      outcome: "received";
      bytes: number;
      events: number;
      rejectedSpans: number;
      hint?: string | undefined;
    }>;

export type GovernanceIngestWebhookReceipt =
  | Readonly<{ outcome: "wrong-endpoint" }>
  /** This deployment folds no logs, so the webhook can never land one. */
  | Readonly<{ outcome: "not-served" }>
  | Readonly<{ outcome: "received"; bytes: number; eventId: string }>;

export type GovernanceIngestLogReceipt =
  | Readonly<{ outcome: "not-served" }>
  | Readonly<{
      outcome: "received";
      bytes: number;
      logRecords: number;
      costEvents: number;
      ledgerRows: number;
      hint?: string | undefined;
    }>;

export type GovernanceIngestMetricReceipt =
  | Readonly<{ outcome: "not-served" }>
  | Readonly<{ outcome: "unavailable"; errorMessage?: string | undefined }>
  | Readonly<{ outcome: "error" }>
  | Readonly<{
      outcome: "received";
      bytes: number;
      metrics: number;
      acceptedDataPoints: number;
      rejectedDataPoints: number;
      hint?: string | undefined;
    }>;

export type GovernanceIngestReceiverMembers = Readonly<{
  /** The SAME governance service the console reads sources and templates from. */
  governance: () => Pick<
    GovernanceApi,
    "ingestionSourceRecordEventReceived" | "extractCanonicalCostEvents" | "ottlTransform"
  >;
  /**
   * The hidden per-organization governance project every receiver writes
   * under. Lazily ensured and idempotent, so a race-created project resolves
   * cleanly rather than splitting one organization across two tenants.
   */
  projects: () => Pick<GovernanceProjectDirectory, "ensureInternal">;
  /** The trace pipeline. Required — without it there is no receiver at all. */
  traceCollection: GovernanceIngestTraceCollection;
  /** The log pipeline, where this process folds logs. */
  logCollection?: GovernanceIngestLogCollectionChannel | undefined;
  /** The metric pipeline, where this process folds metrics. */
  metricCollection?: GovernanceIngestMetricCollectionChannel | undefined;
  /** The spend ledger a cost event is priced into, where one is composed. */
  spend?: GovernanceIngestSpend | undefined;
  /**
   * The typed client the principal resolution reads. A cost event names a
   * person by EMAIL, and a non-member resolves to no principal while the spend
   * still rolls up at organization, team and project scope.
   */
  directory: () => GovernanceIngestPrincipalDirectory;
}>;

/** What the `/api/ingest` transport hands each signal's payload to. */
export interface GovernanceIngestReceiverApi {
  receiveTraces(batch: GovernanceIngestBatch): Promise<GovernanceIngestTraceReceipt>;
  receiveWebhook(input: {
    source: GovernanceIngestionSource;
    body: string;
  }): Promise<GovernanceIngestWebhookReceipt>;
  receiveLogs(batch: GovernanceIngestBatch): Promise<GovernanceIngestLogReceipt>;
  receiveMetrics(batch: GovernanceIngestBatch): Promise<GovernanceIngestMetricReceipt>;
}

const OTLP_SOURCE_TYPES = new Set(["otel_generic", "claude_cowork", "claude_code"]);
const WEBHOOK_SOURCE_TYPES = new Set(["workato", "otel_generic", "s3_custom"]);
const RESERVED_ORIGIN_PREFIXES = ["langwatch.origin.", "langwatch.ingestion_source."] as const;

/**
 * Stamp `langwatch.origin.*` and `langwatch.ingestion_source.*` onto a
 * payload. Downstream consumers filter on
 * `langwatch.origin.kind = "ingestion_source"`, which is why these are
 * receiver-authoritative rather than advisory.
 */
function buildOriginAttrs(source: GovernanceIngestionSource): IKeyValue[] {
  return [
    { key: "langwatch.origin.kind", value: { stringValue: "ingestion_source" } },
    { key: "langwatch.ingestion_source.id", value: { stringValue: source.id } },
    {
      key: "langwatch.ingestion_source.organization_id",
      value: { stringValue: source.organizationId },
    },
    { key: "langwatch.ingestion_source.source_type", value: { stringValue: source.sourceType } },
  ] as IKeyValue[];
}

/**
 * Receiver-authoritative origin attributes REPLACE any the payload supplied
 * under a reserved key: appending would leave two entries under one key and
 * let a payload forge its own origin.
 */
function withOriginAttrs(
  existing: IKeyValue[] | undefined,
  source: GovernanceIngestionSource,
): IKeyValue[] {
  const caller = (existing ?? []).filter(
    (attribute) => !RESERVED_ORIGIN_PREFIXES.some((prefix) => attribute.key?.startsWith(prefix)),
  );

  return [...caller, ...buildOriginAttrs(source)];
}

function stampOriginAttrs(
  request: IExportTraceServiceRequest,
  source: GovernanceIngestionSource,
): void {
  for (const resourceSpans of request.resourceSpans ?? []) {
    for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
      for (const span of scopeSpans.spans ?? []) {
        span.attributes = withOriginAttrs(span.attributes, source);
      }
    }
  }
}

function stampLogOriginAttrs(
  request: IExportLogsServiceRequest,
  source: GovernanceIngestionSource,
): void {
  for (const resourceLogs of request.resourceLogs ?? []) {
    for (const scopeLogs of resourceLogs.scopeLogs ?? []) {
      for (const record of scopeLogs.logRecords ?? []) {
        record.attributes = withOriginAttrs(record.attributes, source);
      }
    }
  }
}

function stampMetricOriginAttrs(input: {
  request: IExportMetricsServiceRequest;
  source: GovernanceIngestionSource;
}): void {
  for (const resourceMetrics of input.request.resourceMetrics ?? []) {
    const resource = resourceMetrics.resource ?? { attributes: [], droppedAttributesCount: 0 };

    resource.attributes = withOriginAttrs(resource.attributes, input.source);
    resourceMetrics.resource = resource;
  }
}

/**
 * Map a webhook envelope — arbitrary JSON pushed by an upstream platform —
 * onto ONE OTLP log record, because that keeps the unified-trace contract
 * simple: body is the raw JSON string, attributes carry the origin metadata.
 */
function buildWebhookLogRequest(
  rawBody: string,
  source: GovernanceIngestionSource,
): IExportLogsServiceRequest {
  const nowNanos = String(BigInt(nowInstant().epochMilliseconds) * 1_000_000n);

  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: `ingestion-source/${source.sourceType}` },
            },
          ],
          droppedAttributesCount: 0,
        },
        scopeLogs: [
          {
            scope: { name: "langwatch.governance.ingestion", version: "1" },
            logRecords: [
              {
                timeUnixNano: nowNanos,
                observedTimeUnixNano: nowNanos,
                severityNumber: 9, // SeverityNumber.INFO
                severityText: "INFO",
                body: { stringValue: rawBody },
                attributes: buildOriginAttrs(source),
                droppedAttributesCount: 0,
                traceId: new Uint8Array(0),
                spanId: new Uint8Array(0),
                flags: 0,
              },
            ],
            schemaUrl: "",
          },
        ],
        schemaUrl: "",
      },
    ],
  };
}

/** Every data point in a metrics export, across all five point shapes. */
function countMetricDataPoints(request: IExportMetricsServiceRequest): number {
  return (request.resourceMetrics ?? []).reduce(
    (acc, resourceMetrics) =>
      acc +
      (resourceMetrics.scopeMetrics ?? []).reduce(
        (scopeAcc, scopeMetrics) =>
          scopeAcc +
          (scopeMetrics.metrics ?? []).reduce(
            (metricAcc, metric) =>
              metricAcc +
              (metric?.gauge?.dataPoints?.length ?? 0) +
              (metric?.sum?.dataPoints?.length ?? 0) +
              (metric?.histogram?.dataPoints?.length ?? 0) +
              (metric?.exponentialHistogram?.dataPoints?.length ?? 0) +
              (metric?.summary?.dataPoints?.length ?? 0),
            0,
          ),
        0,
      ),
    0,
  );
}

export class GovernanceIngestReceiverService implements GovernanceIngestReceiverApi {
  private constructor(private readonly members: GovernanceIngestReceiverMembers) {}

  static create(members: GovernanceIngestReceiverMembers): GovernanceIngestReceiverService {
    return new GovernanceIngestReceiverService(members);
  }

  /**
   * OTLP/HTTP passthrough for span-shaped sources. A collector re-sends what
   * it could not deliver, so an unreadable body is acknowledged with a `hint`
   * naming what was wrong rather than retried forever.
   */
  async receiveTraces(batch: GovernanceIngestBatch): Promise<GovernanceIngestTraceReceipt> {
    const { source } = batch;

    if (!OTLP_SOURCE_TYPES.has(source.sourceType)) return { outcome: "wrong-endpoint" };

    let bodyBytes = 0;
    let eventCount = 0;
    let rejectedSpans = 0;
    let parseHint: string | undefined;

    try {
      const body = await batch.read();

      bodyBytes = body.byteLength;

      const parsed = parseOtlpTraces(body, batch.contentType);

      if (!parsed.ok) {
        parseHint = parsed.error;
      } else {
        const spans = (parsed.request.resourceSpans ?? []).flatMap((resourceSpans) =>
          (resourceSpans.scopeSpans ?? []).flatMap((scopeSpans) => scopeSpans.spans ?? []),
        );

        eventCount = spans.length;

        if (eventCount > 0) {
          const tenantId = await this.governanceTenantOf(source);

          stampOriginAttrs(parsed.request, source);
          applyOtlpReceiverPolicy(parsed.request, "traces", null);

          const result = await this.members.traceCollection({
            tenantId,
            traceRequest: parsed.request,
          });

          rejectedSpans = result?.rejectedSpans ?? 0;
        }
      }
    } catch (err) {
      parseHint = String(err);
      logger.warn(
        { sourceId: source.id, err: String(err) },
        "otel ingest receive failed (still ack'ing)",
      );
    }

    await this.recordEvent(source);
    logger.info(
      {
        sourceId: source.id,
        sourceType: source.sourceType,
        bytes: bodyBytes,
        events: eventCount,
        rejectedSpans,
      },
      "otel ingest landed in unified trace pipeline",
    );

    return {
      outcome: "received",
      bytes: bodyBytes,
      events: eventCount,
      rejectedSpans,
      hint: parseHint,
    };
  }

  /**
   * Generic JSON webhook for flat-event sources, mapped to ONE OTLP log record
   * — not a synthetic span, because a flat event has no duration and no
   * parent-child tree.
   */
  async receiveWebhook(input: {
    source: GovernanceIngestionSource;
    body: string;
  }): Promise<GovernanceIngestWebhookReceipt> {
    const { source } = input;
    const logCollection = this.members.logCollection;

    if (!logCollection) return { outcome: "not-served" };

    if (!WEBHOOK_SOURCE_TYPES.has(source.sourceType)) return { outcome: "wrong-endpoint" };

    const bodyBytes = input.body.length;
    const envelopeId = `envelope-${nowInstant().epochMilliseconds}-${Math.random().toString(36).slice(2, 10)}`;
    let handoffOk = false;

    try {
      if (bodyBytes > 0) {
        await logCollection({
          tenantId: await this.governanceTenantOf(source),
          organizationId: source.organizationId,
          logRequest: buildWebhookLogRequest(input.body, source),
        });
        handoffOk = true;
      }
    } catch (err) {
      logger.warn(
        { sourceId: source.id, err: String(err) },
        "webhook ingest receive failed (still ack'ing)",
      );
    }

    await this.recordEvent(source);
    logger.info(
      {
        sourceId: source.id,
        sourceType: source.sourceType,
        bytes: bodyBytes,
        envelopeId,
        handoffOk,
      },
      "webhook ingest landed in unified log pipeline",
    );

    return { outcome: "received", bytes: bodyBytes, eventId: envelopeId };
  }

  /**
   * Per-request events on OTLP's standard sub-path. Two things happen: the
   * records reach the log pipeline for forensics, and the cost events inside
   * them are priced into the ledger so budgets and anomaly rules fire on
   * third-party traffic.
   */
  async receiveLogs(batch: GovernanceIngestBatch): Promise<GovernanceIngestLogReceipt> {
    const { source } = batch;
    const logCollection = this.members.logCollection;

    if (!logCollection) return { outcome: "not-served" };

    let bodyBytes = 0;
    let logRecordCount = 0;
    let costEventCount = 0;
    let ledgerRowsWritten = 0;
    let parseHint: string | undefined;

    try {
      const body = await batch.read();

      bodyBytes = body.byteLength;

      const parsed = parseOtlpLogs(body, batch.contentType);

      if (!parsed.ok) {
        parseHint = parsed.error;
      } else {
        logRecordCount = (parsed.request.resourceLogs ?? []).reduce(
          (acc, resourceLogs) =>
            acc +
            (resourceLogs.scopeLogs ?? []).reduce(
              (scopeAcc, scopeLogs) => scopeAcc + (scopeLogs.logRecords?.length ?? 0),
              0,
            ),
          0,
        );

        if (logRecordCount > 0) {
          const tenantId = await this.governanceTenantOf(source);

          stampLogOriginAttrs(parsed.request, source);
          applyOtlpReceiverPolicy(parsed.request, "logs", null);

          try {
            await logCollection({
              tenantId,
              organizationId: source.organizationId,
              logRequest: parsed.request,
            });
          } catch (handoffErr) {
            logger.warn(
              { sourceId: source.id, err: String(handoffErr) },
              "log pipeline handoff failed (cost extraction continues)",
            );
          }

          const events = await this.extractCostEvents({
            source,
            body,
            contentType: batch.contentType,
            parsed: parsed.request,
          });

          costEventCount = events.length;

          const spend = this.members.spend;

          if (events.length > 0 && spend) {
            ledgerRowsWritten += await this.priceCostEvents({
              events,
              source,
              spend,
              governanceProjectId: tenantId,
            });
          }
        }
      }
    } catch (err) {
      parseHint = String(err);
      logger.warn(
        { sourceId: source.id, err: String(err) },
        "otel logs ingest receive failed (still ack'ing)",
      );
    }

    await this.recordEvent(source);
    logger.info(
      {
        sourceId: source.id,
        sourceType: source.sourceType,
        bytes: bodyBytes,
        logRecords: logRecordCount,
        costEvents: costEventCount,
        ledgerRows: ledgerRowsWritten,
      },
      "otel logs ingest landed",
    );

    return {
      outcome: "received",
      bytes: bodyBytes,
      logRecords: logRecordCount,
      costEvents: costEventCount,
      ledgerRows: ledgerRowsWritten,
      hint: parseHint,
    };
  }

  /**
   * The one signal that does NOT acknowledge every failure: a throw AFTER the
   * parse is ours rather than the sender's, so it answers retryably and the
   * source event is deliberately not recorded — the collector re-sends this
   * same request and must not double-count.
   */
  async receiveMetrics(batch: GovernanceIngestBatch): Promise<GovernanceIngestMetricReceipt> {
    const { source } = batch;

    if (!this.members.metricCollection) return { outcome: "not-served" };

    let bodyBytes = 0;
    let metricCount = 0;
    let rejectedDataPoints = 0;
    let acceptedDataPoints = 0;
    let parseHint: string | undefined;

    try {
      const body = await batch.read();

      bodyBytes = body.byteLength;

      const parsed = parseOtlpMetrics(body, batch.contentType);

      if (!parsed.ok) {
        parseHint = parsed.error;
      } else {
        metricCount = countMetricDataPoints(parsed.request);

        // Gate on the payload carrying metrics AT ALL, not on its data-point
        // arrays being well-formed: a request whose metrics all have malformed
        // data points has a zero pre-count, and skipping validation would
        // acknowledge it as fully accepted with nothing rejected.
        const resourceMetrics = parsed.request.resourceMetrics;
        const hasMetricPayload = Array.isArray(resourceMetrics)
          ? resourceMetrics.length > 0
          : resourceMetrics != null;

        if (hasMetricPayload) {
          // Scoped away from the outer catch, which turns anything it sees
          // into a `hint` on an acknowledgement.
          const collected = await this.collectParsedMetrics(parsed.request, source);

          if (collected.outcome !== "ok") return collected;

          rejectedDataPoints = collected.rejectedDataPoints;
          acceptedDataPoints = collected.acceptedDataPoints;
          parseHint = collected.parseHint;
        }
      }
    } catch (err) {
      parseHint = String(err);
    }

    await this.recordEvent(source);
    logger.info(
      { sourceId: source.id, bytes: bodyBytes, metrics: metricCount },
      "otel metrics ingest landed",
    );

    return {
      outcome: "received",
      bytes: bodyBytes,
      metrics: metricCount,
      acceptedDataPoints,
      rejectedDataPoints,
      hint: parseHint,
    };
  }

  /** Project resolution, provenance stamping and collection, in one step. */
  private async collectParsedMetrics(
    parsedRequest: IExportMetricsServiceRequest,
    source: GovernanceIngestionSource,
  ): Promise<
    | Readonly<{ outcome: "unavailable"; errorMessage?: string | undefined }>
    | Readonly<{ outcome: "error" }>
    | Readonly<{
        outcome: "ok";
        rejectedDataPoints: number;
        acceptedDataPoints: number;
        parseHint?: string | undefined;
      }>
  > {
    const metricCollection = this.members.metricCollection;

    if (!metricCollection) return { outcome: "error" };

    try {
      const tenantId = await this.governanceTenantOf(source);

      stampMetricOriginAttrs({ request: parsedRequest, source });
      applyOtlpReceiverPolicy(parsedRequest, "metrics", null);

      const result = await metricCollection({
        tenantId,
        organizationId: source.organizationId,
        metricRequest: parsedRequest,
      });

      if (result.outcome === "unavailable") {
        return { outcome: "unavailable", errorMessage: result.errorMessage };
      }

      return {
        outcome: "ok",
        rejectedDataPoints: result.rejectedDataPoints,
        acceptedDataPoints: result.acceptedDataPoints,
        parseHint: result.errorMessage,
      };
    } catch (error) {
      logger.error(
        { error, sourceId: source.id },
        "otel metrics ingest failed after parsing; answering retryably",
      );

      return { outcome: "error" };
    }
  }

  /**
   * Cost-event extraction via OTTL. Any source carrying
   * `parserConfig.ottlStatements` uses the gateway transform; a transform
   * failure falls back to canonical extraction over the ORIGINAL payload, so a
   * rejected statement set is a configuration problem rather than lost events.
   */
  private async extractCostEvents(input: {
    source: GovernanceIngestionSource;
    body: ArrayBuffer;
    contentType: string | undefined;
    parsed: IExportLogsServiceRequest;
  }): Promise<CanonicalCostEvent[]> {
    const governance = this.members.governance();
    const { source } = input;
    const parserConfig = (source.parserConfig as Record<string, unknown> | null) ?? {};
    const ottlStatements = Array.isArray(parserConfig.ottlStatements)
      ? (parserConfig.ottlStatements as unknown[]).filter(
          (statement): statement is string =>
            typeof statement === "string" && statement.trim().length > 0,
        )
      : [];

    if (ottlStatements.length === 0) return [];

    const declaredType = (input.contentType ?? "").toLowerCase();
    const encoding: "json" | "proto" = declaredType.includes("json") ? "json" : "proto";

    try {
      const result = await governance.ottlTransform({
        sourceId: source.id,
        kind: "log",
        encoding,
        payloadB64: Buffer.from(input.body).toString("base64"),
        statements: ottlStatements,
      });

      if (!result.ok) {
        logger.warn(
          {
            sourceId: source.id,
            errorCount: result.errors.length,
            firstError: result.errors[0]?.message,
          },
          "OTTL transform rejected statements at receive — falling back to un-mutated extraction",
        );

        return governance.extractCanonicalCostEvents(input.parsed);
      }

      const mutated = Buffer.from(result.payloadB64, "base64");
      const mutatedBytes = mutated.buffer.slice(
        mutated.byteOffset,
        mutated.byteOffset + mutated.byteLength,
      ) as ArrayBuffer;
      const reparsed = parseOtlpLogs(
        mutatedBytes,
        result.encoding === "json" ? "application/json" : "application/x-protobuf",
      );

      if (!reparsed.ok) {
        logger.warn(
          { sourceId: source.id, err: reparsed.error },
          "OTTL transform returned unparseable payload — falling back to un-mutated extraction",
        );

        return governance.extractCanonicalCostEvents(input.parsed);
      }

      return governance.extractCanonicalCostEvents(reparsed.request);
    } catch (transformErr) {
      logger.warn(
        { sourceId: source.id, err: String(transformErr) },
        "OTTL transform request failed — falling back to un-mutated extraction",
      );

      return governance.extractCanonicalCostEvents(input.parsed);
    }
  }

  /**
   * One debit row per (event, applicable budget). Every failure here is
   * per-event and logged rather than fatal: the batch was already
   * acknowledged, and losing the rest of it because one event named an unknown
   * user would turn a partial attribution gap into total data loss.
   */
  private async priceCostEvents(input: {
    events: readonly CanonicalCostEvent[];
    source: GovernanceIngestionSource;
    spend: GovernanceIngestSpend;
    governanceProjectId: string;
  }): Promise<number> {
    const { events, source, spend, governanceProjectId } = input;
    const directory = this.members.directory();
    let ledgerRowsWritten = 0;

    for (const event of events) {
      try {
        // Resolved by email, inside the source's organization only. An unknown
        // or non-member address attributes to nobody and the spend still rolls
        // up at organization, team and project scope.
        let principalUserId: string | null = null;

        if (event.userEmail) {
          principalUserId = await directory.findMemberIdByEmail({
            email: event.userEmail,
            organizationId: source.organizationId,
          });

          if (!principalUserId) {
            logger.info(
              {
                sourceId: source.id,
                userEmail: event.userEmail,
                anthropicAccountId: event.raw["user.account_id"],
                requestId: event.requestId,
              },
              "ingestion-source event from non-member email — falling back to org/team/project scope only",
            );
          }
        }

        // Sentinel team and virtual-key ids for ingestion-source rows: the
        // applicable-scopes signature requires non-null strings, and a sentinel
        // that cannot be a real id naturally excludes the narrow TEAM budgets
        // while organization, project and principal budgets still match.
        const sentinelVK = `_ingestion_:${source.id}`;
        // Attributed-user templates bucket spend per END user and an ingestion
        // source carries none, so a row here could only name the bare anchor.
        const budgets = (
          await spend.resolveApplicableBudgets({
            organizationId: source.organizationId,
            teamId: source.teamId ?? `_ingestion_:${source.id}`,
            projectId: governanceProjectId,
            virtualKeyId: sentinelVK,
            principalUserId,
          })
        )
          .map(({ budget }) => budget)
          .filter((budget) => budget.scopeType !== "ATTRIBUTED_USER");

        if (budgets.length === 0) continue;

        // The reported cost is a decimal string, so it is pinned to an integer
        // once, here, and every total downstream adds those integers.
        const nano = usdToNanoUsd(event.costUsd);
        const nanoNum = Number(nano);

        if (!Number.isSafeInteger(nanoNum)) {
          logger.error(
            { costUsd: event.costUsd, nanoUsd: nano.toString(), requestId: event.requestId },
            "budget: amountNanoUsd exceeds Number.MAX_SAFE_INTEGER, skipping debit row to avoid silent rounding",
          );
          continue;
        }

        const rows = budgets.map((budget) => ({
          tenantId: governanceProjectId,
          budgetId: budget.id,
          scope: budget.scopeType,
          scopeId: budget.scopeId,
          window: budget.window,
          virtualKeyId: sentinelVK,
          gatewayRequestId: event.requestId,
          amountNanoUsd: nanoNum,
          tokensInput: event.inputTokens,
          tokensOutput: event.outputTokens,
          tokensCacheRead: event.cacheReadTokens,
          tokensCacheWrite: event.cacheCreationTokens,
          model: event.model,
          durationMs: 0,
          status: "SUCCESS" as const,
          occurredAt: event.occurredAt,
        }));

        await spend.insertDebit(rows);
        ledgerRowsWritten += rows.length;

        // A change event so the gateway's subscriber evicts its cache and the
        // next request re-resolves against the fresh spend. Its failure is
        // logged rather than raised: the row has already landed, and the cache
        // is corrected by the next change anyway.
        try {
          await spend.appendChange({
            organizationId: source.organizationId,
            projectId: governanceProjectId,
            kind: "BUDGET_UPDATED",
            payload: {
              source: "ingestion_source",
              sourceId: source.id,
              requestId: event.requestId,
              userEmail: event.userEmail,
              budgetIds: budgets.map((budget) => budget.id),
              amountUsd: event.costUsd,
            },
          });
        } catch (changeErr) {
          logger.warn(
            { sourceId: source.id, requestId: event.requestId, err: String(changeErr) },
            "BUDGET_UPDATED emit failed (ledger row already landed)",
          );
        }
      } catch (eventErr) {
        logger.warn(
          { sourceId: source.id, requestId: event.requestId, err: String(eventErr) },
          "ingestion-source event ledger-write failed (continuing batch)",
        );
      }
    }

    return ledgerRowsWritten;
  }

  private async governanceTenantOf(source: GovernanceIngestionSource): Promise<string> {
    const project = await this.members.projects().ensureInternal({
      organizationId: source.organizationId,
      kind: "internal_governance",
    });

    return project.id;
  }

  private recordEvent(source: GovernanceIngestionSource): Promise<unknown> {
    return this.members.governance().ingestionSourceRecordEventReceived(source.id);
  }
}
