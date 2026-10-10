/**
 * @vitest-environment node
 * A person's identity log, read through eventing's read seat in the person's own tenant.
 * Spec: modules/identity/specs/identity-pipeline-registration-ownership.feature
 */
import {
  createTenantId,
  type Event,
  EventLogReadSeat,
  EventStoreProducerOnly,
  eventToRecord,
  PipelineEventStore,
} from "@langwatch/eventing";
import { EventRepositoryMemory } from "@langwatch/eventing/testing";
import {
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTITY_PIPELINE_NAME,
  MFA_ENROLLED_EVENT_TYPE,
  USER_IDENTITY_AGGREGATE_TYPE,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { EventingIdentityHistoryRepository } from "../eventing.identity-history.repository.ts";

const SAM = "user_sam";
const ALEX = "user_alex";
const T0 = 1_700_000_000_000;
const API_PROCESS = "langwatch-api";

function fact(input: { id: string; type: string; occurredAt: number }): Event {
  return {
    ...input,
    aggregateId: SAM,
    aggregateType: USER_IDENTITY_AGGREGATE_TYPE,
    tenantId: createTenantId(SAM),
    createdAt: input.occurredAt,
    version: "2026-08-20",
    data: { identifierId: "idf_1", provider: "email", value: "sam@acme.com" },
  };
}

function isAnyEvent(_event: unknown): _event is unknown {
  return true;
}

/** What the api composes: a store refusing every read, and a read seat over the same log. */
async function apiProcessOver(events: Event[]) {
  const log = EventRepositoryMemory.createForTesting();
  await log.insertEventRecords(events.map((event) => eventToRecord(event)));
  const refusingStore = EventStoreProducerOnly.create({ processName: API_PROCESS });
  const ownStore = PipelineEventStore.create({
    pipeline: IDENTITY_PIPELINE_NAME,
    log: () => refusingStore,
  });
  ownStore.bindTo({ aggregate: { type: USER_IDENTITY_AGGREGATE_TYPE } });
  return {
    ownStore,
    repository: EventingIdentityHistoryRepository.create({
      eventReadSeat: EventLogReadSeat.create({ repository: log }),
    }),
  };
}

describe("given a person whose identity log holds an identifier and an MFA enrollment", () => {
  const events = [
    fact({ id: "evt_1", type: IDENTIFIER_ATTACHED_EVENT_TYPE, occurredAt: T0 }),
    fact({ id: "evt_2", type: MFA_ENROLLED_EVENT_TYPE, occurredAt: T0 + 1 }),
  ];

  describe("when their history is read in a process that only sends commands", () => {
    /** @scenario "A person's identity history is readable from a process that only sends commands" */
    it("lists the facts newest first, MFA included, while the process's own store refuses", async () => {
      const { repository, ownStore } = await apiProcessOver(events);

      const entries = await repository.findHistory({ userId: SAM, limit: 10 });

      expect(entries.map((entry) => entry.eventId)).toEqual(["evt_2", "evt_1"]);
      await expect(
        ownStore.read({ tenantId: SAM, aggregateId: SAM, accepts: isAnyEvent }),
      ).rejects.toMatchObject({
        name: "ConfigurationError",
        context: { processName: API_PROCESS, operation: "getEvents" },
      });
    });

    /** @scenario "A person's identity history is readable from a process that only sends commands" */
    it("answers the person's link proposals from the same scan", async () => {
      const { repository } = await apiProcessOver(events);

      await expect(repository.findProposals({ userId: SAM })).resolves.toEqual([]);
    });

    it("finds nothing under another person's tenant", async () => {
      const { repository } = await apiProcessOver(events);

      await expect(repository.findHistory({ userId: ALEX, limit: 10 })).resolves.toEqual([]);
    });
  });
});
