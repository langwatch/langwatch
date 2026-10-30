// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/insight-lifecycle.feature
 */
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import { INSIGHT_EVENT_TYPES } from "@langwatch/insight-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryPostHogChannel } from "../../channels/memory/memory.posthog.channel.ts";
import { MemoryNurturingClaimRepository } from "../../repositories/memory/memory.nurturing.repositories.ts";
import { NurturingDeliveryService } from "../../services/nurturing-delivery.service.ts";
import { buildNurturingPipeline } from "../nurturing.pipeline.ts";

const AT = Date.UTC(2026, 9, 30, 12);
const SECRET_WORDS = ["Latency", "p95 went up", "SELECT", "insight-1", "board-1", "Ops board"];

/** The pipeline's lanes, delivering each signal through a real delivery over a memory PostHog. */
function nurturing() {
  const delivered: NurturingSignal[] = [];
  const posthog = MemoryPostHogChannel.create();
  const delivery = NurturingDeliveryService.create({
    claims: MemoryNurturingClaimRepository.create(),
    users: createApiFixture<UserApi>({}),
    posthog,
  });
  const pipeline = buildNurturingPipeline({
    deliver: async (input) => {
      delivered.push(input.signal);
      await delivery.deliver(input);
    },
    projectCreated: async () => undefined,
    guidedTurnFailed: async () => undefined,
    usageReportReceived: async () => undefined,
    evaluationsCompleted: async () => undefined,
    simulationRunsFinished: async () => undefined,
    codingSessionsStored: async () => undefined,
  });
  const subscribers: EventSubscriberDefinition<Event>[] = [];
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({ registerEventSubscriber: (subscriber) => void subscribers.push(subscriber) });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  const handle = async (event: Event) => {
    for (const lane of subscribers.filter(({ eventTypes }) => eventTypes.includes(event.type))) {
      await lane.handle?.(event, { tenantId: event.tenantId, aggregateId: event.aggregateId });
    }
  };
  return {
    delivered,
    posthog,
    handle,
    lanesOf: (type: string) => subscribers.filter(({ eventTypes }) => eventTypes.includes(type)),
  };
}

function insightFact({ type, id, data }: { type: string; id: string; data: object }): Event {
  return {
    id,
    aggregateId: "insight-1",
    aggregateType: "insight",
    tenantId: createTenantId("project-1"),
    createdAt: AT,
    occurredAt: AT,
    type,
    version: "2026-10-09",
    data: { tenantId: "project-1", occurredAt: AT, ...data },
  } as Event;
}

const filing = (owner: { ownerUserId: string | null; filedByUserId: string | null }) =>
  insightFact({
    type: INSIGHT_EVENT_TYPES.FILED,
    id: "evt-filed",
    data: {
      insightId: "insight-1",
      title: "Latency doubled",
      body: "p95 went up",
      tone: "bad",
      topic: null,
      validDays: 7,
      lwql: "SELECT count() FROM traces",
      replay: null,
      source: null,
      board: { id: "board-1", name: "Ops board", widget: { id: "widget-1", name: "Latency" } },
      filedVia: "run",
      findingKey: "latency",
      ...owner,
    },
  });

async function settle(): Promise<void> {
  for (let tick = 0; tick < 3; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("nurturing's insight peer subscribers", () => {
  describe("when insight records a filing with an owner", () => {
    /** @scenario "A filed insight is tracked once on its owner with its bounded facts" */
    it("tracks insights.filed.insight once on the owner with only bounded facts", async () => {
      const { delivered, posthog, handle } = nurturing();

      await handle(filing({ ownerUserId: "user-1", filedByUserId: null }));
      await settle();

      expect(delivered.map((signal) => [signal.kind, "userId" in signal && signal.userId])).toEqual(
        [["insight_acted", "user-1"]],
      );
      expect(posthog.tracked).toEqual([
        {
          userId: "user-1",
          event: "insights.filed.insight",
          properties: { filedVia: "run", tone: "bad", fromBoard: true, projectId: "project-1" },
        },
      ]);
      const sent = JSON.stringify(posthog.tracked);
      for (const word of SECRET_WORDS) expect(sent).not.toContain(word);
    });
  });

  describe("when insight records a filing with no owner and no filer", () => {
    /** @scenario "A filing with no owner and no filer sends nothing" */
    it("delivers no signal", async () => {
      const { delivered, posthog, handle } = nurturing();

      await handle(filing({ ownerUserId: null, filedByUserId: null }));
      await settle();

      expect(delivered).toEqual([]);
      expect(posthog.tracked).toEqual([]);
    });
  });

  describe("when the owner acts on their insight", () => {
    /** @scenario "The owner's act on an insight is tracked once on that person" */
    it.each([
      ["seen", INSIGHT_EVENT_TYPES.SEEN],
      ["archived", INSIGHT_EVENT_TYPES.ARCHIVED],
      ["kept", INSIGHT_EVENT_TYPES.KEPT],
    ] as const)("tracks insights.%s.insight once on that person", async (act, type) => {
      const { delivered, posthog, handle } = nurturing();

      await handle(
        insightFact({ type, id: `evt-${act}`, data: { insightId: "insight-1", userId: "user-1" } }),
      );
      await settle();

      expect(delivered).toHaveLength(1);
      expect(posthog.tracked).toEqual([
        {
          userId: "user-1",
          event: `insights.${act}.insight`,
          properties: { projectId: "project-1" },
        },
      ]);
    });
  });

  describe("when a run renews an insight", () => {
    /** @scenario "A renewed insight is not tracked" */
    it("has no lane for the renewal", () => {
      const { lanesOf } = nurturing();

      expect(lanesOf(INSIGHT_EVENT_TYPES.RENEWED)).toEqual([]);
    });
  });
});
