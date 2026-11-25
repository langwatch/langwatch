/**
 * A key's first admitted request is recorded once, from the drained admission batch.
 * Spec: modules/gateway/specs/gateway-governance-events.feature
 */
import { createTenantId, type EventingCommandSender } from "@langwatch/eventing";
import type {
  GatewayInternalSpendCommandRecord,
  RecordVkFirstRequestCommandData,
} from "@langwatch/gateway-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { type Instant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { virtualKeyRow } from "../../app/__tests__/gateway-virtual-key.fixture.ts";
import { RecordVkFirstRequestCommand } from "../../eventing/gateway-governance-events.intent.ts";
import { GatewaySpendCommandIngestService } from "../../features/spend/services/gateway-spend-command-ingest.service.ts";
import type { GatewaySpendRating } from "../../features/spend/services/model-catalog-gateway-spend-rating.service.ts";
import { MemoryGatewayInternalStoreRepository } from "../../repositories/memory/memory.gateway-internal-store.repository.ts";
import { GatewayGovernanceEventsService } from "../gateway-governance-events.service.ts";

const ORG_ID = "org-1";
const PROJECT_ID = "project-trace";
const NOW = Temporal.Instant.from("2026-11-23T10:00:00Z");

const flatRating: GatewaySpendRating = { rate: () => ({ costNanoUsd: 0, rateVersion: "test" }) };

function recordingSender(refusal?: Error) {
  const sent: RecordVkFirstRequestCommandData[] = [];
  const sender: Pick<EventingCommandSender<unknown>, "send"> = {
    send: async (payload) => {
      if (refusal) throw refusal;
      sent.push(payload as RecordVkFirstRequestCommandData);
    },
  };
  return { sent, sender };
}

function keyRow(id: string, lastUsedAt: Instant | null) {
  return { ...virtualKeyRow(), id, organizationId: ORG_ID, traceProjectId: PROJECT_ID, lastUsedAt };
}

function admit(virtualKeyId: string): GatewayInternalSpendCommandRecord {
  return {
    command: "admitSpend",
    pod_id: "pod-a",
    pod_seq: 1,
    payload: {
      gateway_request_id: `req-${virtualKeyId}-${Math.random()}`,
      occurred_at: NOW.epochMilliseconds,
      organization_id: ORG_ID,
      project_id: PROJECT_ID,
      virtual_key_id: virtualKeyId,
      model: "gpt-x",
    },
  };
}

function harness({
  keys,
  refusal,
  clock = () => NOW,
}: {
  keys: ReturnType<typeof keyRow>[];
  refusal?: Error;
  clock?: () => Instant;
}) {
  const projects = createApiFixture<ProjectApi>({
    listIdsByOrganization: async () => [PROJECT_ID],
    listNamesByIds: async () => [],
    findWithTeam: async () => null,
  });
  const firstRequests = GatewayGovernanceEventsService.create({ projects, clock });
  const recorded = recordingSender(refusal);
  firstRequests.connect({ recordVkFirstRequest: recorded.sender });
  const admitted: unknown[] = [];
  const ingest = GatewaySpendCommandIngestService.create({
    spend: {
      commands: {
        admitSpend: { send: async (payload) => void admitted.push(payload) },
        confirmSpend: { send: async () => undefined },
        failSpend: { send: async () => undefined },
      },
      rating: flatRating,
    },
    store: MemoryGatewayInternalStoreRepository.create({ virtualKeys: keys }),
    projects,
    firstRequests,
  });
  return { ingest, recorded, admitted };
}

function idempotencyKeyOf(data: RecordVkFirstRequestCommandData) {
  return new RecordVkFirstRequestCommand()
    .handle({
      type: "lw.governance.record_vk_first_request",
      tenantId: createTenantId(data.tenantId),
      aggregateId: `vk:${data.virtual_key_id}`,
      data,
    })
    .then(([event]) => event?.idempotencyKey);
}

describe("GatewaySpendCommandIngestService first requests", () => {
  describe("when a batch admits a key that was never used and one that was", () => {
    /** @scenario "A key's first admitted request records one first-request fact" */
    it("records one first-request fact for the unused key only", async () => {
      const { ingest, recorded } = harness({
        keys: [keyRow("vk-new", null), keyRow("vk-used", NOW.subtract({ hours: 1 }))],
      });

      const result = await ingest.submitSpendCommands([
        admit("vk-new"),
        admit("vk-new"),
        admit("vk-used"),
      ]);

      expect(result).toMatchObject({ status: "accepted", accepted: 3 });
      expect(recorded.sent).toEqual([
        {
          tenantId: PROJECT_ID,
          organization_id: ORG_ID,
          virtual_key_id: "vk-new",
          occurred_at: NOW.epochMilliseconds,
        },
      ]);
    });

    it("records nothing more once the key's lastUsedAt has advanced", async () => {
      const { ingest, recorded } = harness({ keys: [keyRow("vk-new", null)] });

      await ingest.submitSpendCommands([admit("vk-new")]);
      await ingest.submitSpendCommands([admit("vk-new")]);

      expect(recorded.sent.map((data) => data.virtual_key_id)).toEqual(["vk-new"]);
    });
  });

  describe("when two batches both read the key before either advanced it", () => {
    /** @scenario "Two batches that both see an unused key record its first request once" */
    it("keys both first-request facts alike, so the key's first request appends once", async () => {
      const first = harness({ keys: [keyRow("vk-new", null)] });
      const second = harness({
        keys: [keyRow("vk-new", null)],
        clock: () => NOW.add({ seconds: 5 }),
      });

      await Promise.all([
        first.ingest.submitSpendCommands([admit("vk-new")]),
        second.ingest.submitSpendCommands([admit("vk-new")]),
      ]);

      const [once] = first.recorded.sent;
      const [twice] = second.recorded.sent;
      expect(once && twice).toBeTruthy();
      const keys = await Promise.all([idempotencyKeyOf(once!), idempotencyKeyOf(twice!)]);
      expect(keys[0]).toBe(`${PROJECT_ID}:vk_first_request:vk-new`);
      expect(keys[1]).toBe(keys[0]);
    });
  });

  describe("when the first-request fact cannot be recorded", () => {
    /** @scenario "Failing to record a first-request fact never fails the spend batch" */
    it("still accepts and appends the batch", async () => {
      const { ingest, admitted } = harness({
        keys: [keyRow("vk-new", null)],
        refusal: new Error("event store down"),
      });

      const result = await ingest.submitSpendCommands([admit("vk-new")]);

      expect(result).toMatchObject({ status: "accepted", accepted: 1 });
      expect(admitted).toHaveLength(1);
    });
  });
});
