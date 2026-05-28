import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { Command, CommandHandler } from "../../../";
import {
	createTenantId,
	defineCommandSchema,
	EventUtils,
} from "../../../";
import { createLogger } from "../../../../../utils/logger/server";
import {
	DEFAULT_PII_REDACTION_LEVEL,
	recordSpanCommandDataSchema,
	type PIIRedactionLevel,
	type RecordSpanCommandData,
} from "../schemas/commands";
import {
	RECORD_SPAN_COMMAND_TYPE,
	SPAN_RECEIVED_EVENT_TYPE,
	SPAN_RECEIVED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type { SpanReceivedEvent } from "../schemas/events";
import type { OtlpResource, OtlpSpan } from "../schemas/otlp";
import { OtlpSpanCostEnrichmentService, createCostEnrichmentDeps } from "~/server/app-layer/traces/span-cost-enrichment.service";
import { OtlpSpanPiiRedactionService } from "~/server/app-layer/traces/span-pii-redaction.service";
import { OtlpSpanTokenEstimationService } from "~/server/app-layer/traces/span-token-estimation.service";
import { TiktokenClient } from "~/server/app-layer/clients/tokenizer/tiktoken.client";
import { featureFlagService } from "~/server/featureFlag";
import { TraceRequestUtils } from "../utils/traceRequest.utils";
import { capOversizedAttributes } from "../utils/capOversizedAttributes";

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
}

function createDefaultDependencies(): RecordSpanCommandDependencies {
  // Lazily require prisma only when defaults are needed (i.e. production path).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { prisma } = require("~/server/db") as { prisma: import("@prisma/client").PrismaClient };
  return {
    piiRedactionService: new OtlpSpanPiiRedactionService(),
    costEnrichmentService: new OtlpSpanCostEnrichmentService(
      createCostEnrichmentDeps(prisma),
    ),
    tokenEstimationService: new OtlpSpanTokenEstimationService({
      tokenizer: new TiktokenClient(),
      featureFlagService,
    }),
  };
}

/**
 * Command handler for recording spans in the trace processing pipeline.
 */
export class RecordSpanCommand implements CommandHandler<
  Command<RecordSpanCommandData>,
  SpanReceivedEvent
> {
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
  private readonly blobStore?: import("~/server/app-layer/traces/blob-store.service").BlobStore;

  constructor(deps?: RecordSpanCommandDependencies, blobStore?: import("~/server/app-layer/traces/blob-store.service").BlobStore) {
    this.deps = deps ?? createDefaultDependencies();
    this.blobStore = blobStore;
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
        let resolvedCommandData = commandData;
        if (commandData.spoolRef && this.blobStore) {
          const spoolBody = await this.blobStore.getSpool(commandData.spoolRef);
          const parsed = JSON.parse(spoolBody.toString("utf-8")) as {
            span: OtlpSpan;
            resource: OtlpResource | null;
            instrumentationScope: unknown | null;
          };
          resolvedCommandData = {
            ...commandData,
            span: parsed.span,
            resource: parsed.resource,
            instrumentationScope: parsed.instrumentationScope as typeof commandData.instrumentationScope,
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

        // ADR-022: After event_log INSERT (which happens when storeEvents is called
        // by the caller), best-effort delete the transient spool object.
        // The deleteSpool happens here (within handle) after the events are
        // constructed, as a best-effort cleanup. The actual INSERT hasn't happened
        // yet (that's done by storeEvents externally), but we delete after
        // successful event construction to keep the spool lifecycle in the
        // command handler's scope. The 24h lifecycle policy is the safety net.
        if (commandData.spoolRef && this.blobStore) {
          await this.blobStore.deleteSpool(commandData.spoolRef).catch((err: unknown) => {
            this.logger.warn(
              { spoolRef: commandData.spoolRef, error: err instanceof Error ? err.message : String(err) },
              "Best-effort spool deletion failed — lifecycle policy will clean up",
            );
          });
        }

        return events;
      },
    );
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

    const strip = (attributes: OtlpSpan["attributes"]): OtlpSpan["attributes"] => {
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
