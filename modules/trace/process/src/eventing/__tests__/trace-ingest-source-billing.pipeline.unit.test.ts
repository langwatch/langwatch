/**
 * @vitest-environment node
 * Trace folds governance's coding-assistant billing fact through its own peer subscriber, so it
 * keeps no governance peer. Spec: specs/server/otlp-receiver-policy.feature
 */
import {
  CODING_ASSISTANT_BILLING_AGGREGATE_TYPE,
  CODING_ASSISTANT_BILLING_EVENT_TYPES,
  CODING_ASSISTANT_BILLING_EVENT_VERSIONS,
  type CodingAssistantBillingRecordedEventData,
  codingAssistantBillingAggregateId,
  codingAssistantBillingRecordedEventDataSchema,
} from "@langwatch/enterprise-governance-contract";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MemoryTraceIngestSourceBillingRepository } from "../../repositories/memory/memory.trace-ingest-source-billing.repository.ts";
import { TraceIngestSourceBillingService } from "../../services/trace-ingest-source-billing.service.ts";
import { buildTraceIngestSourceBillingPipeline } from "../trace-ingest-source-billing.pipeline.ts";

const ORG = "organization-1";

/** Governance's pipeline as its contract names the fact. */
function governanceStandIn() {
  return definePipeline({
    name: "governance_stand_in",
    aggregate: defineAggregate({ type: CODING_ASSISTANT_BILLING_AGGREGATE_TYPE }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(CODING_ASSISTANT_BILLING_EVENT_TYPES.RECORDED),
        data: codingAssistantBillingRecordedEventDataSchema,
      }),
    ])
    .build();
}

function harness() {
  const repository = MemoryTraceIngestSourceBillingRepository.create();
  const billing = TraceIngestSourceBillingService.create({ repository });
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const governance = eventing.register(governanceStandIn());
  eventing.register(buildTraceIngestSourceBillingPipeline({ billing }));
  const record = (data: CodingAssistantBillingRecordedEventData, id: string) =>
    governance.service.storeEvents(
      [
        {
          id,
          aggregateId: codingAssistantBillingAggregateId(data),
          aggregateType: CODING_ASSISTANT_BILLING_AGGREGATE_TYPE,
          tenantId: createTenantId(data.organizationId),
          type: CODING_ASSISTANT_BILLING_EVENT_TYPES.RECORDED,
          version: CODING_ASSISTANT_BILLING_EVENT_VERSIONS.RECORDED,
          createdAt: data.recordedAtMs,
          occurredAt: data.recordedAtMs,
          data,
        },
      ],
      { tenantId: createTenantId(data.organizationId) },
    );
  return { eventing, record, repository };
}

describe("given trace's ingest source billing pipeline beside governance's billing fact", () => {
  describe("when governance records a billed fact, then an older unbilled one arrives late", () => {
    /** @scenario "Trace folds the billing fact and an absent row is non-billable" */
    it("folds the fact into trace's row and keeps the newer answer", async () => {
      const { eventing, record, repository } = harness();

      await record(
        { organizationId: ORG, sourceType: "claude_code", billed: true, recordedAtMs: 200 },
        "event-billed",
      );
      await vi.waitFor(async () =>
        expect(await repository.find({ organizationId: ORG, sourceType: "claude_code" })).toEqual({
          billed: true,
          recordedAtMs: 200,
        }),
      );

      await record(
        { organizationId: ORG, sourceType: "claude_code", billed: false, recordedAtMs: 100 },
        "event-late",
      );
      await record(
        { organizationId: ORG, sourceType: "codex", billed: false, recordedAtMs: 150 },
        "event-codex",
      );
      await vi.waitFor(async () =>
        expect(await repository.find({ organizationId: ORG, sourceType: "codex" })).not.toBeNull(),
      );
      await expect(
        repository.find({ organizationId: ORG, sourceType: "claude_code" }),
      ).resolves.toEqual({
        billed: true,
        recordedAtMs: 200,
      });
      await eventing.close();
    });
  });
});
