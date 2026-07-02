import { SpanKind } from "@opentelemetry/api";
import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { TiktokenClient } from "~/server/app-layer/clients/tokenizer/tiktoken.client";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import {
  createCostEnrichmentDeps,
  OtlpSpanCostEnrichmentService,
} from "~/server/app-layer/traces/span-cost-enrichment.service";
import { OtlpSpanBlockClassificationService } from "~/server/app-layer/traces/span-block-classification.service";
import { OtlpSpanPiiRedactionService } from "~/server/app-layer/traces/span-pii-redaction.service";
import { OtlpSpanTokenEstimationService } from "~/server/app-layer/traces/span-token-estimation.service";
import { matchModelCostWithFallbacks } from "~/server/background/workers/collector/cost";
import { getStaticModelCosts } from "~/server/modelProviders/llmModelCost";
import {
  applyOtlpSpanContentDrop,
  type SpanContentDropResult,
} from "~/server/data-privacy/applyOtlpSpanContentDrop";
import { featureFlagService } from "~/server/featureFlag";
import { createLogger } from "../../../../../utils/logger/server";
import type { Command, CommandHandler } from "../../../";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
  type TenantId,
} from "../../../";
import {
  DEFAULT_PII_REDACTION_LEVEL,
  type PIIRedactionLevel,
  type RecordSpanCommandData,
  recordSpanCommandDataSchema,
} from "../schemas/commands";
import {
  RECORD_SPAN_COMMAND_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type { SpanReceivedEvent } from "../schemas/events";
import type {
  OtlpInstrumentationScope,
  OtlpResource,
  OtlpSpan,
} from "../schemas/otlp";
import { capOversizedAttributes } from "../utils/capOversizedAttributes";
import { TraceRequestUtils } from "../utils/traceRequest.utils";

/**
 * Deduplication options for the `recordSpan` command at the GroupQueue layer.
 *
 * Same `(tenantId, traceId, spanId)` dispatched within the TTL window is
 * squashed into the existing staged job (`extend + replace`) instead of
 * accumulating new HSET fields in the group `:data` hash. Without this,
 * a re-firing reactor (e.g. `claudeCodeSpanSync`) or a customer retry storm
 * grows the hash unboundedly until Redis runs out of memory.
 *
 * Exported so the dedup-coverage integration test can import the exact same
 * shape rather than reproducing it inline — keeps production and the test
 * registered against a single source of truth.
 */
export const RECORD_SPAN_DEDUPLICATION = {
  makeId: (payload: RecordSpanCommandData) =>
    `${payload.tenantId}:${payload.span.traceId}:${payload.span.spanId}`,
  ttlMs: 30_000,
  extend: true,
  replace: true,
} as const;

/**
 * Dependencies for RecordSpanCommand that can be injected for testing.
 */
export interface RecordSpanCommandDependencies {
  /** Service for redacting PII from spans. */
  piiRedactionService: {
    redactSpan: (
      span: OtlpSpan,
      resource: OtlpResource | null,
      piiRedactionLevel: PIIRedactionLevel,
      tenantId?: TenantId,
    ) => Promise<void>;
  };
  /** Service for enriching spans with custom LLM cost rates. */
  costEnrichmentService: {
    enrichSpan: (span: OtlpSpan, tenantId: string) => Promise<void>;
  };
  /** Service for estimating token counts from input/output text. */
  tokenEstimationService: {
    estimateSpanTokens: (args: {
      span: OtlpSpan;
      tenantId?: string;
    }) => Promise<void>;
  };
  /** Service for dropping configured content categories per the data-privacy policy. */
  contentDropService: {
    dropSpanContent: (args: {
      span: OtlpSpan;
      projectId: string;
    }) => Promise<SpanContentDropResult>;
  };
  /**
   * ADR-033: Optional ingest-time content-block classifier. When present, it
   * classifies coding-agent spans and stamps per-category cost attributes.
   * Non-critical: absence is a no-op, and a throw is caught and logged so
   * classification never fails ingestion.
   */
  blockClassificationService?: {
    classifySpanBlocks: (args: {
      span: OtlpSpan;
      instrumentationScope?: OtlpInstrumentationScope | null;
      tenantId?: string;
    }) => Promise<void>;
  };
  /**
   * ADR-022: Optional BlobStore for spool fetch (when command carries spoolRef)
   * and post-store spool deletion. When absent, spoolRef commands are rejected.
   */
  blobStore?: BlobStore;
}

function createDefaultDependencies(): RecordSpanCommandDependencies {
  // Lazily require prisma only when defaults are needed (i.e. production path).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { prisma } = require("~/server/db") as { prisma: PrismaClient };
  return {
    piiRedactionService: new OtlpSpanPiiRedactionService(),
    costEnrichmentService: new OtlpSpanCostEnrichmentService(
      createCostEnrichmentDeps(prisma),
    ),
    tokenEstimationService: new OtlpSpanTokenEstimationService({
      tokenizer: new TiktokenClient(),
      featureFlagService,
    }),
    contentDropService: { dropSpanContent: applyOtlpSpanContentDrop },
    blockClassificationService: new OtlpSpanBlockClassificationService({
      tokenizer: new TiktokenClient(),
      // Registry-backed per-tier rates for standard models (custom rates on the
      // span win first). Injected here so the classifier service stays decoupled
      // from the prisma-backed cost module.
      resolveModelPrices: (model: string) => {
        const matched = matchModelCostWithFallbacks(model, getStaticModelCosts());
        if (!matched) return null;
        const inputRate = matched.inputCostPerToken ?? 0;
        return {
          inputCostPerToken: inputRate,
          outputCostPerToken: matched.outputCostPerToken ?? 0,
          cacheReadCostPerToken: matched.cacheReadCostPerToken ?? inputRate,
          cacheCreationCostPerToken:
            matched.cacheCreationCostPerToken ?? inputRate,
        };
      },
    }),
  };
}

/**
 * Command handler for recording spans in the trace processing pipeline.
 */
export class RecordSpanCommand
  implements CommandHandler<Command<RecordSpanCommandData>, SpanReceivedEvent>
{
  static readonly schema = defineCommandSchema(
    RECORD_SPAN_COMMAND_TYPE,
    recordSpanCommandDataSchema,
    "Command to record a span in the trace processing pipeline",
  );

  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.record-span",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:record-span",
  );
  private readonly deps: RecordSpanCommandDependencies;
  private readonly blobStore?: BlobStore;

  /**
   * @param deps - Optional partial of injectable dependencies. Any omitted
   *   required field is filled in from `createDefaultDependencies()`. This lets
   *   call sites inject just one dependency (e.g. `{ blobStore }` from the
   *   composition root for ADR-022 spool support) without having to also
   *   construct PII / cost / token services.
   *
   *   Preserves the lazy-require pattern: `createDefaultDependencies()` (which
   *   pulls in prisma) is only invoked when at least one required field is
   *   missing. Tests that pass a complete deps object skip the prisma require
   *   entirely.
   */
  constructor(deps?: Partial<RecordSpanCommandDependencies>) {
    let resolved: RecordSpanCommandDependencies;
    if (!deps) {
      resolved = createDefaultDependencies();
    } else if (
      deps.piiRedactionService &&
      deps.costEnrichmentService &&
      deps.tokenEstimationService &&
      deps.contentDropService
    ) {
      // Caller provided every required field — use as-is, skip the prisma require.
      resolved = deps as RecordSpanCommandDependencies;
    } else {
      // Partial deps — fill in missing required fields from defaults.
      resolved = { ...createDefaultDependencies(), ...deps };
    }
    this.deps = resolved;
    this.blobStore = resolved.blobStore;
  }

  async handle(
    command: Command<RecordSpanCommandData>,
  ): Promise<SpanReceivedEvent[]> {
    return await this.tracer.withActiveSpan(
      "RecordSpanCommand.handle",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "command.type": command.type,
          "command.aggregate_id": command.aggregateId,
          "tenant.id": command.tenantId,
        },
      },
      async () => {
        const { tenantId: tenantIdStr, data: commandData } = command;
        const tenantId = createTenantId(tenantIdStr);

        // ADR-022: Oversized command path — reconstitute span from S3 spool.
        // When spoolRef is present, the command was spooled at the edge because
        // the payload exceeded COMMAND_INLINE_THRESHOLD. Fetch the full span,
        // then process normally.

        // ADR-022: Guard — if the command carries a spoolRef but this handler
        // has no blobStore, we MUST throw rather than silently proceeding.
        // The edge cleared span.attributes to [] before spooling, so continuing
        // without reconstitution would write a span with empty attributes to
        // event_log — permanent, silent data loss (event_log is the sole source
        // of truth). Throwing lets the command framework retry / surface the
        // misconfiguration instead of corrupting durable storage.
        if (commandData.spoolRef && !this.blobStore) {
          throw new Error(
            `ADR-022: command carries spoolRef "${commandData.spoolRef}" but this handler has no blobStore configured to reconstitute the span. Refusing to emit a span with cleared attributes (would be permanent data loss in event_log).`,
          );
        }

        let resolvedCommandData = commandData;
        if (commandData.spoolRef && this.blobStore) {
          const spoolBody = await this.blobStore.getSpool(commandData.spoolRef);
          // ADR-022: spool body is the full serialized RecordSpanCommandData.
          // Merge the spooled span/resource/instrumentationScope fields back into
          // the in-flight command (the queue message carries only spoolRef + id fields).
          const parsed = JSON.parse(
            spoolBody.toString("utf-8"),
          ) as RecordSpanCommandData;
          resolvedCommandData = {
            ...commandData,
            span: parsed.span,
            resource: parsed.resource,
            instrumentationScope: parsed.instrumentationScope,
          };
        }

        const { traceId, spanId } = TraceRequestUtils.normalizeOtlpSpanIds(
          resolvedCommandData.span,
        );

        this.logger.debug(
          {
            tenantId,
            traceId,
            spanId,
          },
          "Handling record span command",
        );

        // Clone span and resource before mutation to preserve command immutability
        const spanToProcess = structuredClone(resolvedCommandData.span);
        const resourceToProcess = resolvedCommandData.resource
          ? structuredClone(resolvedCommandData.resource)
          : null;

        // Strip any user-submitted langwatch.reserved.* attributes — this domain
        // is reserved for system-generated attributes only.
        RecordSpanCommand.stripReservedAttributes(
          spanToProcess,
          resourceToProcess,
          this.logger,
        );

        // Cap oversized attribute values (multi-MB base64 images, huge params)
        // before this span becomes a folded event. The trace-processing fold
        // state is read-modify-written in Redis per event; multi-MB values
        // saturate the single-threaded command loop and collapse folding
        // throughput. Capping here keeps the fold state small for every
        // ingestion path that dispatches recordSpan (collector REST and OTLP).
        //
        // ADR-022: Skip the cap for spool-reconstituted spans. When a command
        // carries a spoolRef, the full content has already bypassed the Redis
        // pressure point and MUST be written to event_log in its entirety.
        // The cap's purpose is Redis safety, not event_log correctness.
        //
        // SAFETY DEPENDENCY: this skip is only safe because `leanForProjection`
        // runs UNCONDITIONALLY in eventSourcingService.ts (between storeEvents and
        // dispatch) to lean the projection state. If that lean step is ever made
        // conditional, spool-reconstituted (full-content) spans would re-introduce
        // the Redis fold-state clog this cap otherwise guards against.
        if (!commandData.spoolRef) {
          const cappedAttributeCount = capOversizedAttributes(
            spanToProcess,
            resourceToProcess,
          );
          if (cappedAttributeCount > 0) {
            this.logger.warn(
              { tenantId, traceId, spanId, cappedAttributeCount },
              "Capped oversized span attribute value(s) before ingestion",
            );
          }
        }

        const piiRedactionLevel =
          resolvedCommandData.piiRedactionLevel ?? DEFAULT_PII_REDACTION_LEVEL;

        // Run PII redaction, cost enrichment, and token estimation in parallel.
        // Safe: PII modifies existing attr values; cost and tokens push new entries.
        const [piiResult, costResult, tokenResult] = await Promise.allSettled([
          this.deps.piiRedactionService.redactSpan(
            spanToProcess,
            resourceToProcess,
            piiRedactionLevel,
            tenantId,
          ),
          this.deps.costEnrichmentService.enrichSpan(
            spanToProcess,
            tenantIdStr,
          ),
          this.deps.tokenEstimationService.estimateSpanTokens({
            span: spanToProcess,
            tenantId: tenantIdStr,
          }),
        ]);

        // Cost enrichment is non-critical — log and continue
        if (costResult.status === "rejected") {
          this.logger.warn(
            { error: costResult.reason },
            "Cost enrichment failed, continuing without cost data",
          );
        }

        // Token estimation is non-critical — log and continue
        if (tokenResult.status === "rejected") {
          this.logger.warn(
            { error: tokenResult.reason },
            "Token estimation failed, continuing without estimated tokens",
          );
        }

        // PII redaction is critical — unredacted spans must not be emitted
        if (piiResult.status === "rejected") {
          this.logger.error(
            { error: piiResult.reason },
            "PII redaction failed, aborting span processing to prevent PII leak",
          );
          throw piiResult.reason instanceof Error
            ? piiResult.reason
            : new Error(String(piiResult.reason));
        }

        // ADR-033: ingest-time content-block classification. Runs SERIAL after
        // the parallel enrichment block (it consumes cost + tokenizer outputs)
        // and BEFORE content drop, on the redacted span. Classification is
        // non-critical: any throw is caught and logged so it never fails
        // ingestion (ADR-033 "Ingestion never fails on classification").
        if (this.deps.blockClassificationService) {
          try {
            await this.deps.blockClassificationService.classifySpanBlocks({
              span: spanToProcess,
              instrumentationScope: resolvedCommandData.instrumentationScope,
              tenantId: tenantIdStr,
            });
          } catch (error) {
            this.logger.warn(
              { error },
              "Block classification failed, continuing without categories",
            );
          }
        }

        // Apply the scoped data-privacy DROP at this single span choke point,
        // AFTER redaction (dropping a whole category makes redacting it moot).
        // Doing it here, before the event is emitted, means both the stored
        // span and the trace-summary fold (which derives ComputedInput/Output
        // from the same event) never see the dropped categories. The drop fails
        // open internally (a policy-resolution error keeps the span intact and
        // is logged), so this call never aborts span processing.
        const dropResult = await this.deps.contentDropService.dropSpanContent({
          span: spanToProcess,
          projectId: tenantIdStr,
        });
        if (dropResult.droppedCount > 0) {
          this.logger.debug(
            {
              tenantId,
              traceId,
              spanId,
              droppedCount: dropResult.droppedCount,
              droppedCategories: dropResult.droppedCategories,
            },
            "Dropped span content per data-privacy policy",
          );
        }

        const spanReceivedEvent = EventUtils.createEvent<SpanReceivedEvent>({
          aggregateType: "trace",
          aggregateId: traceId,
          tenantId,
          type: SPAN_RECEIVED_EVENT_TYPE,
          version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
          data: {
            span: spanToProcess,
            resource: resourceToProcess,
            instrumentationScope: resolvedCommandData.instrumentationScope,
            piiRedactionLevel,
          },
          metadata: { traceId, spanId },
          occurredAt: resolvedCommandData.occurredAt,
          idempotencyKey: `${tenantIdStr}:${traceId}:${spanId}`,
        });

        this.logger.debug(
          {
            tenantId,
            traceId,
            spanId,
            eventId: spanReceivedEvent.id,
          },
          "Emitting SpanReceivedEvent",
        );

        const events = [spanReceivedEvent];

        return events;
      },
    );
  }

  /**
   * ADR-022: Best-effort spool deletion, invoked by processCommand() AFTER
   * storeEventsFn (event_log INSERT) commits. This ordering ensures the spool
   * is only deleted once the event is durable — if the INSERT fails the spool
   * survives so the command can be retried. The 24h S3 lifecycle policy is the
   * safety net for orphans if this call itself fails.
   *
   * The spoolRef is read from the original command argument rather than instance
   * state, eliminating the race bug that arose when a single handler instance was
   * shared across parallel queue jobs (pipeline.ts uses withCommandInstance).
   */
  async cleanupAfterStore(
    command: Command<RecordSpanCommandData>,
  ): Promise<void> {
    const spoolRef = command.data.spoolRef;
    if (spoolRef && this.blobStore) {
      await this.blobStore.deleteSpool(spoolRef).catch((err: unknown) => {
        this.logger.warn(
          { spoolRef, error: err instanceof Error ? err.message : String(err) },
          "Best-effort spool deletion failed — lifecycle policy will clean up",
        );
      });
    }
  }

  static getAggregateId(payload: RecordSpanCommandData): string {
    return TraceRequestUtils.normalizeOtlpId(payload.span.traceId);
  }

  static getSpanAttributes(
    payload: RecordSpanCommandData,
  ): Record<string, string | number | boolean> {
    const { traceId, spanId } = TraceRequestUtils.normalizeOtlpSpanIds(
      payload.span,
    );

    return {
      "payload.trace.id": traceId,
      "payload.span.id": spanId,
    };
  }

  private static readonly RESERVED_ATTR_PASSTHROUGH = new Set<string>([
    "langwatch.reserved.causality_depth",
  ]);

  /**
   * Strips user-submitted `langwatch.reserved.*` attributes from a span
   * and its events/links/resource. These attributes are reserved for
   * system use and must not be settable by customer SDKs.
   *
   * EXCEPTIONS — system-emitted attributes that ride in on OTLP from
   * trusted internal services (nlpgo, langevals, etc.) and MUST survive
   * this strip because downstream reactors depend on them:
   *
   *   - `langwatch.reserved.causality_depth` — stamped by nlpgo's
   *     `BaggageAttributeProcessor` on every span emitted during an
   *     evaluator workflow run. The evaluationTrigger reactor reads
   *     this on the inbound span_received event to block infinite
   *     loops (post-2026-05-11 incident). Stripping it here would
   *     silently disable the loop-prevention guard in production.
   *
   * If a customer SDK does manage to set one of these from outside,
   * worst case is a one-shot eval-skip on their own trace — bounded
   * impact, and bypassing requires knowing internal attribute names.
   * Far preferable to silently breaking loop prevention.
   */
  private static stripReservedAttributes(
    span: OtlpSpan,
    resource: OtlpResource | null,
    logger: ReturnType<typeof createLogger>,
  ): void {
    const RESERVED_PREFIX = "langwatch.reserved.";

    const strip = (
      attributes: OtlpSpan["attributes"],
    ): OtlpSpan["attributes"] => {
      const filtered = attributes.filter((attr) => {
        if (
          attr.key.startsWith(RESERVED_PREFIX) &&
          !RecordSpanCommand.RESERVED_ATTR_PASSTHROUGH.has(attr.key)
        ) {
          logger.warn(
            { attributeKey: attr.key },
            "Stripped user-submitted langwatch.reserved.* attribute",
          );
          return false;
        }
        return true;
      });
      return filtered;
    };

    span.attributes = strip(span.attributes);
    for (const event of span.events) {
      event.attributes = strip(event.attributes);
    }
    for (const link of span.links) {
      link.attributes = strip(link.attributes);
    }
    if (resource) {
      resource.attributes = strip(resource.attributes);
    }
  }

  static makeJobId(payload: RecordSpanCommandData): string {
    const { traceId, spanId } = TraceRequestUtils.normalizeOtlpSpanIds(
      payload.span,
    );

    return `${payload.tenantId}:${traceId}:${spanId}`;
  }
}
