// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createApiFixture } from "@langwatch/api-fixture";
import type { OrganizationApi, User } from "@langwatch/organization-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import {
  IdentityMatchSuggestionService,
  MAX_SUGGESTIONS_PER_PERSON,
} from "../identity-match-suggestion.service.ts";

const ORG = "org_acme";
const COMPUTED_AT = Temporal.Instant.from("2026-09-03T05:41:00Z");

function memberUser({
  userId,
  name,
  email,
  emailVerified,
}: {
  userId: string;
  name: string | null;
  email: string | null;
  emailVerified: boolean;
}): User {
  const epoch = Temporal.Instant.fromEpochMilliseconds(0);
  return {
    id: userId,
    name,
    email,
    emailVerified,
    image: null,
    pendingSsoSetup: false,
    userHashKey: null,
    twoFactorEnabled: false,
    createdAt: epoch,
    updatedAt: epoch,
    lastLoginAt: null,
    deactivatedAt: null,
    lastHomePath: null,
    tracesExplorerTourDismissedAt: null,
    passkeyNudgeDismissedAt: null,
  };
}

function buildWorld() {
  const repositories = MemoryGovernanceRepositories.create();
  const members: User[] = [];
  const service = IdentityMatchSuggestionService.create({
    discoveredPeople: repositories.discoveredPeople,
    matches: repositories.identityMatches,
    suggestions: repositories.identityMatchSuggestions,
    organizations: createApiFixture<OrganizationApi>({
      findMembersIncludingDeactivated: () => Promise.resolve(members),
    }),
    now: () => COMPUTED_AT,
    logger: createTestLogger().logger,
  });

  const seedPerson = async (displayText: string): Promise<string> => {
    await repositories.discoveredPeople.recordActivitySighting({
      organizationId: ORG,
      provider: "openai_admin",
      rawActorId: `actor:${displayText}`,
      displayText,
      kind: "person",
      earliestAt: COMPUTED_AT.subtract({ hours: 2 }),
      latestAt: COMPUTED_AT.subtract({ hours: 1 }),
    });
    const [row] = await repositories.discoveredPeople.findByActorIds({
      organizationId: ORG,
      provider: "openai_admin",
      rawActorIds: [`actor:${displayText}`],
    });
    if (!row) throw new Error("the seeded person is missing");
    return row.id;
  };

  const member = (userId: string, name: string) =>
    members.push(memberUser({ userId, name, email: null, emailVerified: false }));

  const stored = () =>
    repositories.identityMatchSuggestions.findAllByOrganization({ organizationId: ORG });

  return { repositories, service, seedPerson, member, stored };
}

describe("Feature: computing who a provider-named person might be", () => {
  describe("given a display text that resembles a member's name", () => {
    /** @scenario "A name that merely resembles an account becomes a suggestion, never a link" */
    it("stores it as a question for a person, and opens no link", async () => {
      const world = buildWorld();
      const personId = await world.seedPerson("m.silva");
      world.member("user_42", "Maria Silva");

      const outcome = await world.service.recompute({ organizationId: ORG });

      expect(await world.stored()).toEqual([
        expect.objectContaining({
          discoveredPersonId: personId,
          userId: "user_42",
          score: expect.any(Number),
          computedAt: COMPUTED_AT,
        }),
      ]);
      expect(outcome.suggestionsWritten).toBe(1);
      expect(
        await world.repositories.identityMatches.findOpenByOrganization({ organizationId: ORG }),
      ).toEqual([]);
    });
  });

  describe("given a member whose name shares no word with the display text", () => {
    it("never reaches the comparison, which is what keeps the pass affordable", async () => {
      const world = buildWorld();
      await world.seedPerson("Maria Silva");
      world.member("user_42", "Jonas Bakker");

      const outcome = await world.service.recompute({ organizationId: ORG });

      expect(outcome.pairsScored).toBe(0);
      expect(outcome.suggestionsWritten).toBe(0);
    });
  });

  describe("given a resemblance too weak to be worth a decision", () => {
    it("scores the pair and then stores nothing", async () => {
      const world = buildWorld();
      await world.seedPerson("Silva Jonas");
      world.member("user_42", "Silva Bakker");

      const outcome = await world.service.recompute({ organizationId: ORG });

      expect(outcome.pairsScored).toBe(1);
      expect(outcome.suggestionsWritten).toBe(0);
    });
  });

  describe("given a person who already holds an open link", () => {
    it("skips them before scoring, since the answer would be discarded anyway", async () => {
      const world = buildWorld();
      const personId = await world.seedPerson("m.silva");
      world.member("user_42", "Maria Silva");
      await world.repositories.identityMatches.open({
        organizationId: ORG,
        discoveredPersonId: personId,
        userId: "user_42",
        evidenceKind: "verified_email",
        validFrom: COMPUTED_AT,
      });

      const outcome = await world.service.recompute({ organizationId: ORG });

      expect(outcome.peopleConsidered).toBe(0);
      expect(outcome.pairsScored).toBe(0);
    });
  });

  describe("given a person whose automatic linking is halted", () => {
    /** @scenario "A person whose automatic linking is halted gets no suggestions either" */
    it("considers nobody and stores nothing", async () => {
      const world = buildWorld();
      const personId = await world.seedPerson("m.silva");
      world.member("user_42", "Maria Silva");
      await world.repositories.discoveredPeople.suspend({
        id: personId,
        organizationId: ORG,
        at: COMPUTED_AT,
        reason: "ambiguous_verified_email",
      });

      const outcome = await world.service.recompute({ organizationId: ORG });

      expect(outcome.peopleConsidered).toBe(0);
      expect(await world.stored()).toEqual([]);
    });
  });

  describe("given a name that resembles many colleagues", () => {
    it("keeps only the strongest few, so the queue stays something a person finishes", async () => {
      const world = buildWorld();
      await world.seedPerson("Maria Silva");
      for (let index = 0; index < 9; index++) {
        world.member(`user_${index}`, `Maria Silva${"a".repeat(index)}`);
      }

      const outcome = await world.service.recompute({ organizationId: ORG });

      expect(outcome.suggestionsWritten).toBeLessThanOrEqual(MAX_SUGGESTIONS_PER_PERSON);
      const scores = (await world.stored()).map((row) => row.score);
      expect(scores.toSorted((a, b) => b - a)).toEqual(scores);
    });
  });

  describe("given stored suggestions from an earlier run", () => {
    it("replaces them with what the new inputs imply", async () => {
      const world = buildWorld();
      await world.seedPerson("m.silva");
      world.member("user_42", "Maria Silva");
      await world.service.recompute({ organizationId: ORG });

      const second = await world.service.recompute({ organizationId: ORG });

      expect(second).toMatchObject({ suggestionsRemoved: 1, suggestionsWritten: 1 });
      expect(await world.stored()).toHaveLength(1);
    });
  });
});
