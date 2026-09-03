// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Push-mode IngestionSource receivers for the Activity Monitor:
 *
 *   POST /api/ingest/otel/:sourceId              OTLP/HTTP passthrough
 *   POST /api/ingest/webhook/:sourceId           generic JSON webhook
 *   POST /api/ingest/otel/:sourceId/v1/logs      per-request events + cost
 *   POST /api/ingest/otel/:sourceId/v1/metrics   counters, acknowledged
 *
 * Auth is `Authorization: Bearer <ingestSecret>`, resolved by hash lookup with
 * the rotated-secret grace window inside the ingestion-source service.
 *
 * The receivers are thin auth and routing wrappers over the EXISTING trace
 * pipeline. Origin metadata is what distinguishes ingestion data from
 * application traces, and the hidden per-organization governance project is
 * what supplies governance tenancy. There is deliberately no parallel event
 * store and no second write path here.
 *
 * ## What each signal needs, and what its absence means
 *
 * The three collections are separate ports because a process can hold one and
 * not another. A route whose collection is absent is NOT MOUNTED at all, so an
 * exporter gets a 404 from a receiver that honestly does not serve that signal
 * rather than a 500 from one that pretends to — the same rule the project-
 * scoped OTLP receiver follows for logs and metrics.
 *
 * ## Why a parse failure still acknowledges
 *
 * A collector re-sends what it could not deliver. Answering non-2xx to a
 * payload we will never be able to read means an infinite redelivery of the
 * same bad batch, so an unreadable body is acknowledged with a `hint` naming
 * what was wrong. The metrics route is the exception, and deliberately: a
 * throw AFTER the parse is ours rather than the sender's, so it answers 503
 * and does NOT record the source event — the collector's retry must not
 * double-count.
 *
 * Spec contracts: receiver-shapes.feature, architecture-invariants.feature,
 * receiver-auth-rate-limit.feature.
 */
import { handlerManagedAuth } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import {
  type CanonicalCostEvent,
  type GovernanceIngestionSource,
  type GovernanceService,
} from "@langwatch/enterprise-governance-contract";
import { usdToNanoUsd } from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import { parseOtlpLogs, parseOtlpMetrics, parseOtlpTraces, readOtlpBody } from "@langwatch/otlp";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { GovernanceInternalProjectPort } from "@langwatch/project-server";
import {
  enforceApiKeyIdOnLogRequest,
  enforceApiKeyIdOnMetricRequest,
  enforceApiKeyIdOnTraceRequest,
} from "@langwatch/trace-server";
import type {
  IExportLogsServiceRequest,
  IExportMetricsServiceRequest,
  IExportTraceServiceRequest,
  IKeyValue,
} from "@opentelemetry/otlp-transformer";
import type { Context } from "hono";

import {
  extractIngestClientIp,
  type GovernanceIngestRateLimitPort,
} from "../../ports/governance-ingest-rate-limit.port";

const logger = createLogger("langwatch:ingest");

/**
 * The trace pipeline this receiver hands spans to.
 *
 * The three collection ports below are shaped like the project-scoped OTLP
 * receiver's, deliberately: one description of each signal's collection means
 * the two receivers cannot end up disagreeing about what handing a payload off
 * involves. The redaction level is NOT among their arguments for the same
 * reason it is not among that receiver's — it is the composition's decision,
 * fixed once where the collection is built, rather than a per-request choice a
 * transport gets to make.
 */
export type GovernanceIngestTraceCollectionPort = (input: {
  tenantId: string;
  traceRequest: IExportTraceServiceRequest;
}) => Promise<{ rejectedSpans?: number } | undefined>;

/** The log pipeline the webhook and `/v1/logs` receivers hand records to. */
export type GovernanceIngestLogCollectionPort = (input: {
  tenantId: string;
  organizationId: string;
  logRequest: IExportLogsServiceRequest;
}) => Promise<unknown>;

/** The metric pipeline `/v1/metrics` hands data points to. */
export type GovernanceIngestMetricCollectionPort = (input: {
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
 *
 * All three travel together because one write without the others is worse than
 * none: a debit row nobody evicts a cache for is spend the gateway keeps
 * routing against a stale balance. Absent means cost extraction still runs and
 * is reported in the acknowledgement, but nothing is priced — which is what a
 * deployment with no gateway spend store can honestly say.
 */
export type GovernanceIngestSpendPort = Readonly<{
  insertDebit: (rows: ReadonlyArray<Record<string, unknown>>) => Promise<unknown>;
  resolveApplicableBudgets: (scopes: {
    organizationId: string;
    teamId: string;
    projectId: string;
    virtualKeyId: string;
    principalUserId: string | null;
  }) => Promise<
    ReadonlyArray<{
      budget: Readonly<{ id: string; scopeType: string; scopeId: string; window: string }>;
    }>
  >;
  appendChange: (input: {
    organizationId: string;
    projectId: string;
    kind: string;
    payload: Record<string, unknown>;
  }) => Promise<unknown>;
}>;

/** Everything the receivers reach that they do not own. */
export type GovernanceIngestRestPorts = Readonly<{
  /** The SAME governance service the console reads sources and templates from. */
  governance: () => Pick<
    GovernanceService,
    | "tryFindIngestionSourceByIngestSecret"
    | "ingestionSourceRecordEventReceived"
    | "extractCanonicalCostEvents"
    | "ottlTransform"
  >;
  /**
   * The hidden per-organization governance project every receiver writes
   * under.
   *
   * Lazily ensured and idempotent, so a race-created project resolves cleanly
   * rather than splitting one organization's ingestion across two tenants.
   */
  projects: () => Pick<GovernanceInternalProjectPort, "ensureInternal">;
  /** The trace pipeline. Required — without it there is no receiver at all. */
  traceCollection: GovernanceIngestTraceCollectionPort;
  /** The log pipeline, where this process folds logs. */
  logCollection?: GovernanceIngestLogCollectionPort | undefined;
  /** The metric pipeline, where this process folds metrics. */
  metricCollection?: GovernanceIngestMetricCollectionPort | undefined;
  /** The spend ledger a cost event is priced into, where one is composed. */
  spend?: GovernanceIngestSpendPort | undefined;
  /**
   * The typed client the principal resolution reads.
   *
   * A cost event names a person by EMAIL, and attributing spend to them means
   * finding the member row that email belongs to inside the source's own
   * organization. A non-member resolves to no principal and the spend still
   * rolls up at organization, team and project scope.
   */
  database: () => PrismaClient;
  /** The per-caller throttle, where this deployment composed a counter. */
  rateLimit?: GovernanceIngestRateLimitPort | undefined;
}>;

/**
 * Stamp `langwatch.origin.*` and `langwatch.ingestion_source.*` onto a payload.
 *
 * Downstream consumers — the governance fold projection, the OCSF read
 * projection — filter on `langwatch.origin.kind = "ingestion_source"`, which
 * is why these are receiver-authoritative rather than advisory.
 */
function buildOriginAttrs(source: GovernanceIngestionSource): IKeyValue[] {
  return [
    { key: "langwatch.origin.kind", value: { stringValue: "ingestion_source" } },
    { key: "langwatch.ingestion_source.id", value: { stringValue: source.id } },
    {
      key: "langwatch.ingestion_source.organization_id",
      value: { stringValue: source.organizationId },
    },
    {
      key: "langwatch.ingestion_source.source_type",
      value: { stringValue: source.sourceType },
    },
  ] as IKeyValue[];
}

const RESERVED_ORIGIN_PREFIXES = ["langwatch.origin.", "langwatch.ingestion_source."] as const;

/**
 * Receiver-authoritative origin attributes REPLACE any the payload supplied
 * under a reserved key.
 *
 * Appending would leave two entries under one key and make governance
 * attribution depend on which one a downstream flattener happens to keep —
 * i.e. let a payload forge its own origin.
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
  for (const rs of request.resourceSpans ?? []) {
    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        span.attributes = withOriginAttrs(span.attributes, source);
      }
    }
  }
}

function stampLogOriginAttrs(
  request: IExportLogsServiceRequest,
  source: GovernanceIngestionSource,
): void {
  for (const rl of request.resourceLogs ?? []) {
    for (const sl of rl.scopeLogs ?? []) {
      for (const record of sl.logRecords ?? []) {
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
 * onto ONE OTLP log record.
 *
 * One record per envelope rather than per parsed sub-event, because that keeps
 * the unified-trace contract simple: body is the raw JSON string, attributes
 * carry the origin metadata. Per-platform adapters replace this default mapper
 * with their richer shape and hand off to the same target.
 */
function buildWebhookLogRequest(
  rawBody: string,
  source: GovernanceIngestionSource,
): IExportLogsServiceRequest {
  const nowNanos = String(BigInt(Date.now()) * 1_000_000n);
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
              } as never,
            ],
            schemaUrl: "",
          },
        ],
        schemaUrl: "",
      },
    ],
  } as unknown as IExportLogsServiceRequest;
}

/**
 * Cost-event extraction via OTTL.
 *
 * Any source carrying `parserConfig.ottlStatements` uses the gateway
 * transform, regardless of source type. A transform failure falls back to
 * canonical extraction over the ORIGINAL payload, so the receiver can still
 * acknowledge the upstream batch — a rejected statement set is a
 * configuration problem, not a reason to lose the events.
 */
async function extractCostEventsForSource(input: {
  source: GovernanceIngestionSource;
  parsed: IExportLogsServiceRequest;
  rawBody: ArrayBuffer;
  contentType: string | undefined;
  governance: Pick<GovernanceService, "extractCanonicalCostEvents" | "ottlTransform">;
}): Promise<CanonicalCostEvent[]> {
  const asLogsRequest = input.parsed as unknown as Parameters<
    GovernanceService["extractCanonicalCostEvents"]
  >[0];
  const parserConfig = (input.source.parserConfig as Record<string, unknown> | null) ?? {};
  const ottlStatements = Array.isArray(parserConfig.ottlStatements)
    ? (parserConfig.ottlStatements as unknown[]).filter(
        (statement): statement is string =>
          typeof statement === "string" && statement.trim().length > 0,
      )
    : [];

  if (ottlStatements.length === 0) return [];

  const encoding: "json" | "proto" = (input.contentType ?? "").toLowerCase().includes("json")
    ? "json"
    : "proto";
  const payloadB64 = Buffer.from(input.rawBody).toString("base64");

  try {
    const result = await input.governance.ottlTransform({
      sourceId: input.source.id,
      kind: "log",
      encoding,
      payloadB64,
      statements: ottlStatements,
    });
    if (!result.ok) {
      logger.warn(
        {
          sourceId: input.source.id,
          errorCount: result.errors.length,
          firstError: result.errors[0]?.message,
        },
        "OTTL transform rejected statements at receive — falling back to un-mutated extraction",
      );
      return input.governance.extractCanonicalCostEvents(asLogsRequest);
    }
    const mutatedBuffer = Buffer.from(result.payloadB64, "base64");
    const mutatedBytes = mutatedBuffer.buffer.slice(
      mutatedBuffer.byteOffset,
      mutatedBuffer.byteOffset + mutatedBuffer.byteLength,
    ) as ArrayBuffer;
    const mutatedContentType =
      result.encoding === "json" ? "application/json" : "application/x-protobuf";
    const reparsed = parseOtlpLogs(mutatedBytes, mutatedContentType);
    if (!reparsed.ok) {
      logger.warn(
        { sourceId: input.source.id, err: reparsed.error },
        "OTTL transform returned unparseable payload — falling back to un-mutated extraction",
      );
      return input.governance.extractCanonicalCostEvents(asLogsRequest);
    }
    return input.governance.extractCanonicalCostEvents(
      reparsed.request as unknown as Parameters<GovernanceService["extractCanonicalCostEvents"]>[0],
    );
  } catch (transformErr) {
    logger.warn(
      { sourceId: input.source.id, err: String(transformErr) },
      "OTTL transform request failed — falling back to un-mutated extraction",
    );
    return input.governance.extractCanonicalCostEvents(asLogsRequest);
  }
}

/** Builds the `/api/ingest` receiver family over one process's ports. */
export function createGovernanceIngestRestApp(options: {
  security: AppRestSecurity;
  ports: GovernanceIngestRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api/ingest" });

  const ingestAuth = handlerManagedAuth({
    reason: "ingestion source bearer secret resolved in-handler against IngestionSource",
    // A per-source bearer secret, not an RBAC permission.
    permissions: [],
    credential: "internal",
  });

  /**
   * Resolve `Authorization: Bearer <secret>` against the ingestion sources.
   *
   * The regex runs first so a malformed header costs nothing, which is what
   * makes the throttle ahead of it worth having.
   */
  const authIngestionSource = async (c: Context): Promise<GovernanceIngestionSource | null> => {
    const header = c.req.header("Authorization");
    if (!header) return null;
    const match = /^Bearer\s+(lw_is_[A-Za-z0-9_\-]+)$/.exec(header.trim());
    if (!match) return null;
    return await ports.governance().tryFindIngestionSourceByIngestSecret(match[1]!);
  };

  /**
   * The per-caller throttle, wedged BEFORE the secret lookup so brute-force
   * scanners shed at the edge instead of pinging the database.
   */
  const refuseRateLimited = async (c: Context): Promise<Response | null> => {
    const limiter = ports.rateLimit;
    if (!limiter) return null;
    const ip = extractIngestClientIp(c.req.raw.headers);
    const decision = await limiter.check({ ip });
    if (decision.allowed) return null;
    logger.warn(
      { ip, retryAfterSec: decision.retryAfterSec },
      "ingest rate-limit exceeded; rejecting with 429",
    );
    c.header("Retry-After", String(decision.retryAfterSec));
    return c.json(
      {
        error: "rate_limited",
        error_description:
          "Too many requests from this client. Slow down and retry after the Retry-After window.",
      },
      429,
    );
  };

  /**
   * The gate every receiver shares: throttle, then secret, then the path's own
   * source id, which must be the one the secret resolved to.
   *
   * The id check is what stops a valid secret from being pointed at another
   * source's endpoint, and it answers the same bare 401 an unknown secret gets
   * so the response never confirms that some other id exists.
   */
  const resolveSource = async (
    c: Context,
  ): Promise<{ source: GovernanceIngestionSource } | { refusal: Response }> => {
    const limited = await refuseRateLimited(c);
    if (limited) return { refusal: limited };
    const source = await authIngestionSource(c);
    if (!source) return { refusal: c.json({ error: "unauthorized" }, 401) };
    if (c.req.param("sourceId") !== source.id) {
      return { refusal: c.json({ error: "unauthorized" }, 401) };
    }
    return { source };
  };

  // ---------- POST /api/ingest/otel/:sourceId ----------
  // OTLP/HTTP passthrough for span-shaped sources. After the parse: resolve
  // the organization's hidden governance project, stamp origin metadata on
  // every span, and hand off to the existing trace pipeline with that project
  // as the tenant. The receiver never writes storage directly.
  secured.access(ingestAuth).post("/otel/:sourceId", async (c) => {
    const resolved = await resolveSource(c);
    if ("refusal" in resolved) return resolved.refusal;
    const { source } = resolved;

    if (
      source.sourceType !== "otel_generic" &&
      source.sourceType !== "claude_cowork" &&
      source.sourceType !== "claude_code"
    ) {
      return c.json(
        {
          error: "wrong_endpoint",
          error_description:
            "OTLP path is only valid for otel_generic, claude_cowork, and claude_code sources",
        },
        400,
      );
    }

    let bodyBytes = 0;
    let eventCount = 0;
    let rejectedSpans = 0;
    let parseHint: string | undefined;
    try {
      const body = await readOtlpBody(c.req.raw);
      bodyBytes = body.byteLength;
      const parsed = parseOtlpTraces(body, c.req.header("content-type"));
      if (!parsed.ok) {
        parseHint = parsed.error;
      } else {
        const spans = (parsed.request.resourceSpans ?? []).flatMap((rs) =>
          (rs.scopeSpans ?? []).flatMap((ss) => ss.spans ?? []),
        );
        eventCount = spans.length;

        if (eventCount > 0) {
          const govProject = await ports.projects().ensureInternal({
            organizationId: source.organizationId,
            kind: "internal_governance",
          });
          stampOriginAttrs(parsed.request, source);
          // These endpoints authenticate with an ingestion-source secret, so
          // there is no API-key row to attribute the payload to. The attribute
          // is still ENFORCED rather than left alone: a payload-supplied copy
          // has to be dropped, because redaction exempts that name from the
          // secret-name deny-list.
          enforceApiKeyIdOnTraceRequest(
            parsed.request as unknown as Parameters<typeof enforceApiKeyIdOnTraceRequest>[0],
            null,
          );
          const result = await ports.traceCollection({
            tenantId: govProject.id,
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

    await ports.governance().ingestionSourceRecordEventReceived(source.id);
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

    const responseBody: Record<string, unknown> = {
      accepted: true,
      bytes: bodyBytes,
      events: eventCount,
    };
    if (rejectedSpans > 0) responseBody.rejectedSpans = rejectedSpans;
    if (eventCount === 0 && (parseHint || bodyBytes > 0)) {
      responseBody.hint = parseHint
        ? `Body did not parse as OTLP/HTTP: ${parseHint}. See https://docs.langwatch.ai/observability/trace-vs-activity-ingestion for the canonical shape.`
        : "Body received but no spans extracted. OTLP/HTTP expects " +
          "resource_spans[].scope_spans[].spans[] with non-empty spans " +
          "arrays. See https://docs.langwatch.ai/ai-gateway/governance/" +
          "ingestion-sources/otel-generic for a copy-paste curl.";
    }
    return c.json(responseBody, 202);
  });

  const logCollection = ports.logCollection;
  if (logCollection) {
    // ---------- POST /api/ingest/webhook/:sourceId ----------
    // Generic JSON webhook for flat-event sources. Mapped to ONE OTLP log
    // record — not a synthetic span, because a flat event has no duration and
    // no parent-child tree — and handed to the existing log pipeline. Same
    // store, same drill-down; the origin metadata is what separates it from
    // application logs.
    secured.access(ingestAuth).post("/webhook/:sourceId", async (c) => {
      const resolved = await resolveSource(c);
      if ("refusal" in resolved) return resolved.refusal;
      const { source } = resolved;

      if (
        source.sourceType !== "workato" &&
        source.sourceType !== "otel_generic" &&
        source.sourceType !== "s3_custom"
      ) {
        return c.json(
          {
            error: "wrong_endpoint",
            error_description:
              "Webhook path is only valid for workato, otel_generic, and s3_custom (callback-mode) sources",
          },
          400,
        );
      }

      let bodyBytes = 0;
      let envelopeId = "";
      let handoffOk = false;
      try {
        const raw = await c.req.text();
        bodyBytes = raw.length;
        envelopeId = `envelope-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

        if (bodyBytes > 0) {
          const govProject = await ports.projects().ensureInternal({
            organizationId: source.organizationId,
            kind: "internal_governance",
          });
          await logCollection({
            tenantId: govProject.id,
            organizationId: source.organizationId,
            logRequest: buildWebhookLogRequest(raw, source),
          });
          handoffOk = true;
        }
      } catch (err) {
        logger.warn(
          { sourceId: source.id, err: String(err) },
          "webhook ingest receive failed (still ack'ing)",
        );
      }

      await ports.governance().ingestionSourceRecordEventReceived(source.id);
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

      return c.json({ accepted: true, bytes: bodyBytes, eventId: envelopeId }, 202);
    });

    // ---------- POST /api/ingest/otel/:sourceId/v1/logs ----------
    // OTLP-emitting tools post per-request events on the standard sub-path: an
    // admin pastes `{base}/api/ingest/otel/{sourceId}` and the exporter
    // appends the suffix. Two things happen: the records reach the log
    // pipeline for forensics, and the cost events inside them are priced into
    // the ledger so budgets and anomaly rules fire on third-party traffic.
    secured.access(ingestAuth).post("/otel/:sourceId/v1/logs", async (c) => {
      const resolved = await resolveSource(c);
      if ("refusal" in resolved) return resolved.refusal;
      const { source } = resolved;

      let bodyBytes = 0;
      let logRecordCount = 0;
      let costEventCount = 0;
      let ledgerRowsWritten = 0;
      let parseHint: string | undefined;

      try {
        const body = await readOtlpBody(c.req.raw);
        bodyBytes = body.byteLength;
        const contentType = c.req.header("content-type");
        const parsed = parseOtlpLogs(body, contentType);
        if (!parsed.ok) {
          parseHint = parsed.error;
        } else {
          logRecordCount = (parsed.request.resourceLogs ?? []).reduce(
            (acc, rl) =>
              acc + (rl.scopeLogs ?? []).reduce((a, sl) => a + (sl.logRecords?.length ?? 0), 0),
            0,
          );

          if (logRecordCount > 0) {
            const govProject = await ports.projects().ensureInternal({
              organizationId: source.organizationId,
              kind: "internal_governance",
            });
            stampLogOriginAttrs(parsed.request, source);
            enforceApiKeyIdOnLogRequest(
              parsed.request as unknown as Parameters<typeof enforceApiKeyIdOnLogRequest>[0],
              null,
            );
            try {
              await logCollection({
                tenantId: govProject.id,
                organizationId: source.organizationId,
                logRequest: parsed.request,
              });
            } catch (handoffErr) {
              logger.warn(
                { sourceId: source.id, err: String(handoffErr) },
                "log pipeline handoff failed (cost extraction continues)",
              );
            }

            const events = await extractCostEventsForSource({
              source,
              parsed: parsed.request,
              rawBody: body,
              contentType,
              governance: ports.governance(),
            });
            costEventCount = events.length;

            const spend = ports.spend;
            if (events.length > 0 && spend) {
              ledgerRowsWritten += await priceCostEvents({
                events,
                source,
                spend,
                database: ports.database(),
                governanceProjectId: govProject.id,
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

      await ports.governance().ingestionSourceRecordEventReceived(source.id);
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

      const responseBody: Record<string, unknown> = {
        accepted: true,
        bytes: bodyBytes,
        logRecords: logRecordCount,
        costEvents: costEventCount,
        ledgerRows: ledgerRowsWritten,
      };
      if (parseHint) responseBody.hint = parseHint;
      return c.json(responseBody, 202);
    });
  }

  const metricCollection = ports.metricCollection;
  if (metricCollection) {
    // ---------- POST /api/ingest/otel/:sourceId/v1/metrics ----------
    secured.access(ingestAuth).post("/otel/:sourceId/v1/metrics", async (c) => {
      const resolved = await resolveSource(c);
      if ("refusal" in resolved) return resolved.refusal;
      const { source } = resolved;

      let bodyBytes = 0;
      let metricCount = 0;
      let rejectedDataPoints = 0;
      let acceptedDataPoints = 0;
      let parseHint: string | undefined;
      try {
        const body = await readOtlpBody(c.req.raw);
        bodyBytes = body.byteLength;
        const parsed = parseOtlpMetrics(body, c.req.header("content-type"));
        if (!parsed.ok) {
          parseHint = parsed.error;
        } else {
          metricCount = countMetricDataPoints(parsed.request);
          // Gate on the payload carrying metrics AT ALL, not on its data-point
          // arrays being well-formed: a request whose metrics all have
          // malformed data points has a zero pre-count, and skipping
          // validation would acknowledge it as fully accepted with nothing
          // rejected.
          const resourceMetrics = parsed.request.resourceMetrics;
          const hasMetricPayload = Array.isArray(resourceMetrics)
            ? resourceMetrics.length > 0
            : resourceMetrics != null;
          if (hasMetricPayload) {
            // Scoped away from the outer catch, which turns anything it sees
            // into a `hint` on a 202. Past parsing, a throw is no longer the
            // sender's bad payload — it is ours, and acknowledging it drops
            // the batch for good. In both exits below the source event is
            // deliberately NOT recorded: the collector re-sends this same
            // request, so counting it now double-counts it.
            try {
              const govProject = await ports.projects().ensureInternal({
                organizationId: source.organizationId,
                kind: "internal_governance",
              });
              stampMetricOriginAttrs({ request: parsed.request, source });
              enforceApiKeyIdOnMetricRequest(
                parsed.request as unknown as Parameters<typeof enforceApiKeyIdOnMetricRequest>[0],
                null,
              );
              const result = await metricCollection({
                tenantId: govProject.id,
                organizationId: source.organizationId,
                metricRequest: parsed.request,
              });
              if (result.outcome === "unavailable") {
                return c.json({ accepted: false, error: result.errorMessage }, 503);
              }
              rejectedDataPoints = result.rejectedDataPoints;
              acceptedDataPoints = result.acceptedDataPoints;
              parseHint = result.errorMessage;
            } catch (error) {
              logger.error(
                { error, sourceId: source.id },
                "otel metrics ingest failed after parsing; answering retryably",
              );
              return c.json({ accepted: false, error: "failed to record data point" }, 503);
            }
          }
        }
      } catch (err) {
        parseHint = String(err);
      }

      await ports.governance().ingestionSourceRecordEventReceived(source.id);
      logger.info(
        { sourceId: source.id, bytes: bodyBytes, metrics: metricCount },
        "otel metrics ingest landed",
      );

      const responseBody: Record<string, unknown> = {
        accepted: true,
        bytes: bodyBytes,
        metrics: metricCount,
        acceptedDataPoints,
        partialSuccess: {
          rejectedDataPoints,
          ...(parseHint ? { errorMessage: parseHint } : {}),
        },
      };
      if (parseHint) responseBody.hint = parseHint;
      return c.json(responseBody, 202);
    });
  }

  return secured.hono;
}

/** Every data point in a metrics export, across all five point shapes. */
function countMetricDataPoints(request: IExportMetricsServiceRequest): number {
  return (request.resourceMetrics ?? []).reduce(
    (acc, rm) =>
      acc +
      (rm.scopeMetrics ?? []).reduce(
        (scopeAcc, sm) =>
          scopeAcc +
          (sm.metrics ?? []).reduce(
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

/**
 * Price one batch of extracted cost events into the spend ledger, one debit
 * row per (event, applicable budget).
 *
 * Every failure here is per-event and logged rather than fatal: the batch was
 * already acknowledged upstream, and losing the rest of it because one event
 * named an unknown user would turn a partial attribution gap into total data
 * loss. Returns how many rows landed.
 */
async function priceCostEvents(input: {
  events: readonly CanonicalCostEvent[];
  source: GovernanceIngestionSource;
  spend: GovernanceIngestSpendPort;
  database: PrismaClient;
  governanceProjectId: string;
}): Promise<number> {
  const { events, source, spend, database, governanceProjectId } = input;
  let ledgerRowsWritten = 0;

  for (const event of events) {
    try {
      // Resolve the principal by email, inside the source's organization only.
      // An unknown or non-member address attributes to nobody and the spend
      // still rolls up at organization, team and project scope.
      let principalUserId: string | null = null;
      if (event.userEmail) {
        const user = await database.user.findFirst({
          where: {
            email: event.userEmail,
            orgMemberships: { some: { organizationId: source.organizationId } },
          },
          select: { id: true },
        });
        principalUserId = user?.id ?? null;
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

      // Sentinel team and virtual-key ids for ingestion-source rows. The
      // applicable-scopes signature requires non-null strings, and a
      // TEAM-scoped budget matches on `scope=TEAM AND scopeId=teamId`, so a
      // sentinel that cannot be a real id naturally excludes those narrow
      // budgets while organization, project and principal budgets still match.
      // Same shape for the virtual key: an ingestion source has none.
      const sentinelVK = `_ingestion_:${source.id}`;
      // Attributed-user templates bucket spend per END user, and an ingestion
      // source carries none, so a row here could only name the bare anchor: a
      // bucket no enforcement reads, filed under the same (budget, request)
      // identity the per-user row needs. Those accrue on the gateway spend
      // pipeline alone.
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
      // once, here, and every total downstream adds those integers rather than
      // re-deriving from decimals.
      const nano = usdToNanoUsd(event.costUsd);
      const nanoNum = Number(nano);
      if (!Number.isSafeInteger(nanoNum)) {
        logger.error(
          {
            costUsd: event.costUsd,
            nanoUsd: nano.toString(),
            requestId: event.requestId,
          },
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
      // next request re-resolves against the fresh spend. Emitted after the
      // ledger row, and its failure is logged rather than raised: the row has
      // already landed, and the cache is corrected by the next change anyway.
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
