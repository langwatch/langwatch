// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 * Ordering of late sightings against a source's recorded disappearance.
 */
import { type Instant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryDiscoveredAgentRepository } from "../memory.discovered-agent.repository.ts";
import { MemoryDiscoveredPeopleStore } from "../memory.discovered-people.store.ts";

const organizationId = "org_1";
const T1 = Temporal.Instant.from("2026-11-16T10:00:00.000Z");
const T2 = Temporal.Instant.from("2026-11-16T11:00:00.000Z");
const T3 = Temporal.Instant.from("2026-11-16T12:00:00.000Z");
const T4 = Temporal.Instant.from("2026-11-16T13:00:00.000Z");
const T5 = Temporal.Instant.from("2026-11-16T14:00:00.000Z");

async function goneAtT3() {
  const repository = MemoryDiscoveredAgentRepository.create(MemoryDiscoveredPeopleStore.create());
  const sight = (at: Instant) =>
    repository.recordAgentSighting({
      organizationId,
      provider: "aws_bedrock_agents",
      rawAgentId: "arn:aws:bedrock:eu-west-1:111122223333:agent/late",
      displayText: "late",
      metadata: {},
      seenAt: at,
      ingestionSourceId: "source-a",
    });
  await sight(T1);
  await repository.markUnlistedGone({
    organizationId,
    ingestionSourceId: "source-a",
    listedAt: T3,
  });
  const listed = async () =>
    (await repository.findForRegistry({ organizationId })).map((row) => row.displayText);
  return { repository, sight, listed };
}

describe("MemoryDiscoveredAgentRepository.recordAgentSighting", () => {
  describe("when a sighting older than the source's disappearance arrives late", () => {
    it("keeps the agent gone", async () => {
      const { sight, listed } = await goneAtT3();

      await sight(T2);

      expect(await listed()).toEqual([]);
    });
  });

  describe("when a later listing also omits the agent before a late sighting arrives", () => {
    it("keeps the agent gone at the newer absence", async () => {
      const { repository, sight, listed } = await goneAtT3();
      await repository.markUnlistedGone({
        organizationId,
        ingestionSourceId: "source-a",
        listedAt: T5,
      });

      await sight(T4);

      expect(await listed()).toEqual([]);
    });
  });

  describe("when a sighting newer than the disappearance arrives", () => {
    it("brings the agent back", async () => {
      const { sight, listed } = await goneAtT3();

      await sight(T4);

      expect(await listed()).toEqual(["late"]);
    });
  });
});
