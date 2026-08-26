import type { Event } from "@langwatch/eventing";
import { processCommandBatch } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";
import { RecordCanonicalLogCommand } from "../../src/adapters/record-canonical-log.adapter";
import { createLogProcessingPipeline } from "../../src/adapters/log-processing.adapter";
import {
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
  LOG_COMMAND_COALESCE_MAX_BATCH,
  RECORD_CANONICAL_LOG_COMMAND_TYPE,
} from "@langwatch/telemetry-contract";
import type { CanonicalLogRecord } from "@langwatch/telemetry-contract";

const TENANT_ID = "project_log_coalescing";

/** A schema-valid canonical record; only the identity fields vary per item. */
function logRecord({ index }: { index: number }): CanonicalLogRecord {
  return {
    tenantId: TENANT_ID,
    organizationId: "organization-1",
    recordId: index.toString(16).padStart(64, "0"),
    resourceSchemaUrl: "",
    resourceAttributesJson: "[]",
    resourceAttributesFlatJson: "{}",
    resourceAttributeKeys: [],
    resourceDroppedAttributesCount: 0,
    scopeSchemaUrl: "",
    scopeName: "scope",
    scopeVersion: "",
    scopeAttributesJson: "[]",
    scopeAttributeKeys: [],
    scopeDroppedAttributesCount: 0,
    wireTraceId: "",
    wireSpanId: "",
    correlationTraceId: "",
    correlationSpanId: "",
    correlationSource: "none",
    timeUnixNano: "1",
    observedTimeUnixNano: "1",
    timeUnixMs: 1_800_000_000_000 + index,
    severityNumber: 9,
    severityText: "INFO",
    bodyType: "string",
    bodyJson: '"body"',
    bodyText: "body",
    attributesJson: "[]",
    attributesFlatJson: "{}",
    attributeKeys: [],
    droppedAttributesCount: 0,
    flags: 0,
    eventName: "",
    providerKind: "generic",
    providerEventKind: "",
    providerEventSequence: "",
    providerSessionId: "",
    providerConversationId: "",
    providerPromptId: "",
    piiRedactionLevel: "STRICT",
    canonicalPayload: "{}",
    canonicalSizeBytes: 2,
    occurredAt: 1_800_000_000_000 + index,
    acceptedAt: 1_800_000_000_000 + index,
  };
}

function batchParamsFor({
  payloads,
  storeEventsFn,
}: {
  payloads: CanonicalLogRecord[];
  storeEventsFn: (events: Event[], context: unknown) => Promise<void>;
}) {
  return {
    payloads: payloads as unknown as Record<string, unknown>[],
    commandType: RECORD_CANONICAL_LOG_COMMAND_TYPE,
    commandSchema: RecordCanonicalLogCommand.schema,
    handler: new RecordCanonicalLogCommand(),
    getAggregateId: RecordCanonicalLogCommand.getAggregateId,
    storeEventsFn: storeEventsFn as never,
    aggregateType: "log" as const,
    commandName: "recordLogRecord",
    pipelineName: "log_processing",
  };
}

describe("log command append coalescing", () => {
  describe("given the log-processing pipeline is defined", () => {
    describe("when recordLogRecord is registered", () => {
      /** @scenario 'many items for one aggregate become one insert' */
      it("carries an append-coalescing bound alongside its shard routing", () => {
        const pipeline = createLogProcessingPipeline({
          canonicalLogAppendStore: {} as never,
          logCommandShardCount: 8,
        });

        const command = pipeline.commands.find(
          (candidate) => candidate.name === "recordLogRecord",
        );

        expect(command?.options?.coalesceMaxBatch).toBe(LOG_COMMAND_COALESCE_MAX_BATCH);
        expect(command?.options?.getGroupKey).toBeDefined();
      });
    });
  });

  describe("given several queued records from one shard", () => {
    describe("when the coalesced batch is processed", () => {
      /** @scenario 'many items for one aggregate become one insert' */
      /** @scenario 'coalescing preserves every item' */
      it("appends them as one insert holding every record in dispatch order", async () => {
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const payloads = [0, 1, 2, 3].map((index) => logRecord({ index }));

        await processCommandBatch(batchParamsFor({ payloads, storeEventsFn }));

        expect(storeEventsFn).toHaveBeenCalledTimes(1);
        const [events, context] = storeEventsFn.mock.calls[0]!;
        expect((events as Event[]).map((event) => event.aggregateId)).toEqual(
          payloads.map((payload) => payload.recordId),
        );
        expect(
          (events as Event[]).every(
            (event) => event.type === CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
          ),
        ).toBe(true);
        expect(context).toEqual({ tenantId: TENANT_ID });
      });

      /** @scenario 'coalescing preserves every item' */
      it("keeps each record's idempotency key so a retry cannot duplicate it", async () => {
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const payloads = [0, 1].map((index) => logRecord({ index }));

        await processCommandBatch(batchParamsFor({ payloads, storeEventsFn }));

        const [events] = storeEventsFn.mock.calls[0]!;
        expect((events as Event[]).map((event) => event.idempotencyKey)).toEqual(
          payloads.map((payload) => `${TENANT_ID}:${payload.recordId}`),
        );
      });
    });
  });
});
