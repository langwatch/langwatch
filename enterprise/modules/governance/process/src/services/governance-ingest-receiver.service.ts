// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a push-mode IngestionSource payload becomes: origin metadata stamped
 * receiver-authoritatively, the existing trace / log / metric pipelines handed
 * the batch under the organization's hidden governance project, and the cost
 * events inside a log batch priced into the spend ledger.
 */
import type {
  GovernanceIngestionSource,
  GovernanceOttlGateway,
} from "@langwatch/enterprise-governance-contract";
import { type GatewayApi } from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import { applyOtlpReceiverPolicy, parseOtlpLogs, parseOtlpTraces } from "@langwatch/otlp";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";
import type {
  IExportLogsServiceRequest,
  IExportMetricsServiceRequest,
  IExportTraceServiceRequest,
} from "@opentelemetry/otlp-transformer";

import {
  buildWebhookLogRequest,
  countLogRecords,
  countSpans,
  stampLogOriginAttrs,
  stampOriginAttrs,
} from "../rules/governance-ingest-payload.rules.ts";
import type { CanonicalCostExtractorService } from "./canonical-cost-extractor.service.ts";
import { GovernanceIngestCostService } from "./governance-ingest-cost.service.ts";
import { GovernanceIngestLandingService } from "./governance-ingest-landing.service.ts";
import { GovernanceIngestMetricReceiverService } from "./governance-ingest-metric-receiver.service.ts";
import type { IngestionSourceService } from "./ingestion-source.service.ts";

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
  | Readonly<{
      outcome: "collected";
      errorMessage?: string | undefined;
      rejectedDataPoints: number;
      acceptedDataPoints: number;
    }>
  | Readonly<{ outcome: "unavailable"; errorMessage: string }>
>;

/**
 * The spend ledger and change feed an extracted cost event lands in, or none.
 * All three travel together because one write without the others is worse than
 * none: a debit row nobody evicts a cache for is spend the gateway keeps
 * routing against a stale balance.
 */
export type GovernanceIngestSpend = Pick<
  GatewayApi,
  "resolveApplicableBudgets" | "insertSpendDebit" | "appendBudgetChange"
>;

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
  | Readonly<{ outcome: "received"; bytes: number; eventId: string }>;

export type GovernanceIngestLogReceipt = Readonly<{
  outcome: "received";
  bytes: number;
  logRecords: number;
  costEvents: number;
  ledgerRows: number;
  hint?: string | undefined;
}>;

export type GovernanceIngestMetricReceipt =
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
  /** The SAME source service the console reads sources from; it stamps each received event. */
  sources: Pick<IngestionSourceService, "recordEventReceived">;
  /** Canonical cost extraction, run over the log batch the OTTL rules may have rewritten. */
  costEvents: Pick<CanonicalCostExtractorService, "extract">;
  /** The gateway's OTTL engine, for sources whose parser config carries statements. */
  ottl: Pick<GovernanceOttlGateway, "transform">;
  /**
   * The hidden per-organization governance project every receiver writes
   * under. Lazily ensured and idempotent, so a race-created project resolves
   * cleanly rather than splitting one organization across two tenants.
   */
  projects: Pick<ProjectApi, "ensureInternal">;
  /** The trace pipeline. Required — without it there is no receiver at all. */
  traceCollection: GovernanceIngestTraceCollection;
  /** The log pipeline: OTLP log records and webhook envelopes. */
  logCollection: GovernanceIngestLogCollectionChannel;
  /** The metric pipeline. */
  metricCollection: GovernanceIngestMetricCollectionChannel;
  /** The spend ledger a cost event is priced into. */
  spend: GovernanceIngestSpend;
  /**
   * The typed client the principal resolution reads. A cost event names a
   * person by EMAIL, and a non-member resolves to no principal while the spend
   * still rolls up at organization, team and project scope.
   */
  directory: GovernanceIngestPrincipalDirectory;
}>;

/** What the `/api/ingest` transport hands each signal's payload to. */
export interface GovernanceIngestReceiverApi {
  receiveTraces: (batch: GovernanceIngestBatch) => Promise<GovernanceIngestTraceReceipt>;
  receiveWebhook(input: {
    source: GovernanceIngestionSource;
    body: string;
  }): Promise<GovernanceIngestWebhookReceipt>;
  receiveLogs(batch: GovernanceIngestBatch): Promise<GovernanceIngestLogReceipt>;
  receiveMetrics(batch: GovernanceIngestBatch): Promise<GovernanceIngestMetricReceipt>;
}

const OTLP_SOURCE_TYPES = new Set(["otel_generic", "claude_cowork", "claude_code"]);
const WEBHOOK_SOURCE_TYPES = new Set(["workato", "otel_generic", "s3_custom"]);

export class GovernanceIngestReceiverService implements GovernanceIngestReceiverApi {
  private readonly costs: GovernanceIngestCostService;
  private readonly landing: GovernanceIngestLandingService;
  private readonly metrics: GovernanceIngestMetricReceiverService;

  private constructor(private readonly members: GovernanceIngestReceiverMembers) {
    this.costs = GovernanceIngestCostService.create(members);
    this.landing = GovernanceIngestLandingService.create(members);
    this.metrics = GovernanceIngestMetricReceiverService.create({
      members,
      landing: this.landing,
    });
  }

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
        eventCount = countSpans(parsed.request);

        if (eventCount > 0) {
          const tenantId = await this.landing.governanceTenantOf(source);

          stampOriginAttrs(parsed.request, source);
          applyOtlpReceiverPolicy({ request: parsed.request, signal: "traces", apiKeyId: null });

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

    await this.landing.recordEvent(source);
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
    const { logCollection } = this.members;

    if (!WEBHOOK_SOURCE_TYPES.has(source.sourceType)) return { outcome: "wrong-endpoint" };

    const bodyBytes = input.body.length;
    const envelopeId = `envelope-${nowInstant().epochMilliseconds}-${Math.random().toString(36).slice(2, 10)}`;
    let handoffOk = false;

    try {
      if (bodyBytes > 0) {
        await logCollection({
          tenantId: await this.landing.governanceTenantOf(source),
          organizationId: source.organizationId,
          logRequest: buildWebhookLogRequest({
            rawBody: input.body,
            source,
            nowNanos: String(BigInt(nowInstant().epochMilliseconds) * 1_000_000n),
          }),
        });
        handoffOk = true;
      }
    } catch (err) {
      logger.warn(
        { sourceId: source.id, err: String(err) },
        "webhook ingest receive failed (still ack'ing)",
      );
    }

    await this.landing.recordEvent(source);
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

    let bodyBytes = 0;
    let logRecordCount = 0;
    const landed = { costEvents: 0, ledgerRows: 0 };
    let parseHint: string | undefined;

    try {
      const body = await batch.read();

      bodyBytes = body.byteLength;

      const parsed = parseOtlpLogs(body, batch.contentType);

      if (!parsed.ok) {
        parseHint = parsed.error;
      } else {
        logRecordCount = countLogRecords(parsed.request);

        if (logRecordCount > 0) {
          await this.landParsedLogs({ batch, body, request: parsed.request, landed });
        }
      }
    } catch (err) {
      parseHint = String(err);
      logger.warn(
        { sourceId: source.id, err: String(err) },
        "otel logs ingest receive failed (still ack'ing)",
      );
    }

    await this.landing.recordEvent(source);
    logger.info(
      {
        sourceId: source.id,
        sourceType: source.sourceType,
        bytes: bodyBytes,
        logRecords: logRecordCount,
        costEvents: landed.costEvents,
        ledgerRows: landed.ledgerRows,
      },
      "otel logs ingest landed",
    );

    return {
      outcome: "received",
      bytes: bodyBytes,
      logRecords: logRecordCount,
      costEvents: landed.costEvents,
      ledgerRows: landed.ledgerRows,
      hint: parseHint,
    };
  }

  receiveMetrics(batch: GovernanceIngestBatch): Promise<GovernanceIngestMetricReceipt> {
    return this.metrics.receiveMetrics(batch);
  }

  /**
   * A non-empty log batch stamped, handed to the log pipeline, and its cost
   * events priced. `landed` is tallied as it goes, so a pricing failure still
   * reports the cost events it extracted.
   */
  private async landParsedLogs({
    batch,
    body,
    request,
    landed,
  }: {
    batch: GovernanceIngestBatch;
    body: ArrayBuffer;
    request: IExportLogsServiceRequest;
    landed: { costEvents: number; ledgerRows: number };
  }): Promise<void> {
    const { source } = batch;
    const tenantId = await this.landing.governanceTenantOf(source);

    stampLogOriginAttrs(request, source);
    applyOtlpReceiverPolicy({ request, signal: "logs", apiKeyId: null });

    try {
      await this.members.logCollection({
        tenantId,
        organizationId: source.organizationId,
        logRequest: request,
      });
    } catch (handoffErr) {
      logger.warn(
        { sourceId: source.id, err: String(handoffErr) },
        "log pipeline handoff failed (cost extraction continues)",
      );
    }

    const events = await this.costs.extractCostEvents({
      source,
      body,
      contentType: batch.contentType,
      parsed: request,
    });

    landed.costEvents = events.length;

    if (events.length > 0) {
      landed.ledgerRows += await this.costs.priceCostEvents({
        events,
        source,
        spend: this.members.spend,
        governanceProjectId: tenantId,
      });
    }
  }
}
