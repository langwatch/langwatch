import { z } from "zod";
import type { TraceSpanIngestPort } from "../ports/trace-span-ingest.port";
import { DEFAULT_PII_REDACTION_LEVEL } from "@langwatch/trace-contract";
import type { CustomMetadata, ReservedTraceMetadata } from "@langwatch/trace-contract";
import { CollectorSpanUtils } from "./trace-collector-span.service";

/**
 * Post-hoc trace metadata updates. A user can amend a trace's metadata after
 * ingestion; we apply it by recording a synthetic `langwatch.metadata_update`
 * span through the standard ingestion pipeline (new keys added, existing keys
 * updated, missing keys preserved; labels replace entirely).
 *
 * The schema + synthesis live here so the two transports that expose this —
 * the tRPC `tracesV2.changeMetadata` mutation and the REST
 * `PATCH /api/trace/v1/:traceId/metadata` route — share one implementation
 * instead of each carrying its own copy.
 */
const metadataValueSchema = z.union([
  z.string().max(4096),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.record(z.string(), z.unknown()),
]);

export const traceMetadataUpdateSchema = z
  .record(z.string(), metadataValueSchema)
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "metadata must contain at least one key",
  })
  .refine((obj) => JSON.stringify(obj).length <= 32768, {
    message: "total metadata payload must not exceed 32KB",
  });

export type TraceMetadataUpdate = z.infer<typeof traceMetadataUpdateSchema>;

/** Metadata keys that map onto the trace's first-class identity fields rather
 *  than free-form custom metadata. */
const RESERVED_METADATA_KEYS = new Set<string>(["user_id", "customer_id", "thread_id", "labels"]);

function splitMetadata(metadata: TraceMetadataUpdate): {
  reserved: ReservedTraceMetadata;
  custom: CustomMetadata;
} {
  const reserved: ReservedTraceMetadata = {};
  const custom: CustomMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (RESERVED_METADATA_KEYS.has(key)) {
      (reserved as Record<string, unknown>)[key] = value;
    } else {
      custom[key] = value as CustomMetadata[string];
    }
  }
  return { reserved, custom };
}

export async function updateTraceMetadata({
  ingest,
  projectId,
  traceId,
  metadata,
}: {
  /** Where the synthetic amendment span is recorded. */
  ingest: TraceSpanIngestPort;
  projectId: string;
  traceId: string;
  metadata: TraceMetadataUpdate;
}): Promise<void> {
  const { reserved, custom } = splitMetadata(metadata);
  const resource = CollectorSpanUtils.buildResource({
    reservedTraceMetadata: reserved,
    customMetadata: custom,
  });

  const now = Date.now();
  const nowNano = String(now * 1_000_000);
  const spanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  await ingest.recordSpan({
    tenantId: projectId,
    span: {
      traceId,
      spanId,
      traceState: null,
      parentSpanId: null,
      name: "langwatch.metadata_update",
      kind: 1,
      startTimeUnixNano: nowNano,
      endTimeUnixNano: nowNano,
      attributes: [{ key: "langwatch.span.type", value: { stringValue: "span" } }],
      events: [],
      links: [],
      status: { code: 1 },
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    },
    resource,
    instrumentationScope: { name: "langwatch.api.metadata_update" },
    piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
    occurredAt: now,
  });
}
