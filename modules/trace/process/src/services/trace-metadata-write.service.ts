import { nowInstant } from "@langwatch/time";
import {
  DEFAULT_PII_REDACTION_LEVEL,
  type CustomMetadata,
  type ReservedTraceMetadata,
  type TraceMetadataUpdate,
} from "@langwatch/trace-contract";

import type { TraceSpanIngest } from "../app/trace.members.ts";
import { TraceCollectorSpanService } from "./trace-collector-span.service.ts";

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

export class TraceMetadataWriteService {
  readonly #ingest: TraceSpanIngest;

  /** `ingest` is where the synthetic amendment span is recorded. */
  static create({ ingest }: { ingest: TraceSpanIngest }): TraceMetadataWriteService {
    return new TraceMetadataWriteService(ingest);
  }

  private constructor(ingest: TraceSpanIngest) {
    this.#ingest = ingest;
  }

  async updateTraceMetadata({
    projectId,
    traceId,
    metadata,
  }: {
    projectId: string;
    traceId: string;
    metadata: TraceMetadataUpdate;
  }): Promise<void> {
    const { reserved, custom } = splitMetadata(metadata);
    const resource = TraceCollectorSpanService.buildResource({
      reservedTraceMetadata: reserved,
      customMetadata: custom,
    });

    const now = nowInstant().epochMilliseconds;
    const nowNano = String(now * 1_000_000);
    const spanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

    await this.#ingest.recordSpan({
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
}
