// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createApiFixture } from "@langwatch/api-fixture";
import {
  IdentityAlreadyLinkedError,
  IdentityErasedError,
  IdentityMatchSuggestionNotFoundError,
} from "@langwatch/enterprise-governance-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { OrganizationApi, User } from "@langwatch/organization-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { MATCH_EVIDENCE_KIND } from "../../rules/identity-evidence.rules.ts";
import { IdentityMatchService } from "../identity-match.service.ts";

const ORG = "org_acme";
const AT = Temporal.Instant.from("2026-09-03T05:41:00Z");

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

/** Real memory twins; spies only inject a race or observe that a read did not happen. */
function buildWorld() {
  const repositories = MemoryGovernanceRepositories.create();
  const members: User[] = [];
  const directoryIds: { userId: string; externalId: string }[] = [];
  const service = IdentityMatchService.create({
    discoveredPeople: repositories.discoveredPeople,
    matches: repositories.identityMatches,
    suggestions: repositories.identityMatchSuggestions,
    organizations: createApiFixture<OrganizationApi>({
      findMembersIncludingDeactivated: () => Promise.resolve(members),
    }),
    directory: createApiFixture<ScimApi>({
      findDirectoryExternalIds: () => Promise.resolve(directoryIds),
    }),
    now: () => AT,
    logger: createTestLogger().logger,
  });

  const seedPerson = async ({
    rawActorId = "m.silva@acme.test",
    displayText = rawActorId,
  }: { rawActorId?: string; displayText?: string } = {}): Promise<string> => {
    await repositories.discoveredPeople.recordActivitySighting({
      organizationId: ORG,
      provider: "openai_admin",
      rawActorId,
      displayText,
      kind: "person",
      earliestAt: AT.subtract({ hours: 48 }),
      latestAt: AT.subtract({ hours: 24 }),
    });
    const [row] = await repositories.discoveredPeople.findByActorIds({
      organizationId: ORG,
      provider: "openai_admin",
      rawActorIds: [rawActorId],
    });
    if (!row) throw new Error("the seeded person is missing");
    return row.id;
  };

  const verifiedMember = (userId: string, email: string) =>
    members.push(memberUser({ userId, name: null, email, emailVerified: true }));

  const erase = (id: string) =>
    repositories.discoveredPeople.pseudonymize({
      id,
      organizationId: ORG,
      pseudonym: "erased-person",
      erasedAt: AT,
    });

  const openLinks = () =>
    repositories.identityMatches.findOpenByOrganization({ organizationId: ORG });

  const suggest = async (discoveredPersonId: string) => {
    await repositories.identityMatchSuggestions.replaceForOrganization({
      organizationId: ORG,
      suggestions: [{ discoveredPersonId, userId: "user_42", score: 0.9 }],
      computedAt: AT,
    });
    const [row] = await repositories.identityMatchSuggestions.findAllByOrganization({
      organizationId: ORG,
    });
    if (!row) throw new Error("the seeded suggestion is missing");
    return row.id;
  };

  return {
    repositories,
    members,
    directoryIds,
    service,
    seedPerson,
    verifiedMember,
    erase,
    openLinks,
    suggest,
  };
}

const uniqueViolation = () =>
  Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { code: "23505" } });

describe("Feature: linking provider-named people to accounts on proof", () => {
  describe("given a person whose address a member has confirmed", () => {
    /** @scenario "An address that matches a confirmed account links without anybody clicking" */
    it("opens one link, dated from when we could first prove it", async () => {
      const world = buildWorld();
      const personId = await world.seedPerson();
      world.verifiedMember("user_42", "m.silva@acme.test");

      const outcome = await world.service.linkProvenMatches({ organizationId: ORG });

      expect(outcome).toEqual({ linked: 1, suspended: 0, unproven: 0 });
      const [link] = await world.repositories.identityMatches.findAllByDiscoveredPerson({
        organizationId: ORG,
        discoveredPersonId: personId,
      });
      expect(link).toMatchObject({
        userId: "user_42",
        evidenceKind: MATCH_EVIDENCE_KIND.VERIFIED_EMAIL,
        validFrom: AT,
      });
    });

    it("normalizes both sides, so a member's address stored in mixed case still matches", async () => {
      const world = buildWorld();
      await world.seedPerson();
      world.verifiedMember("user_42", "M.Silva@Acme.TEST");

      await world.service.linkProvenMatches({ organizationId: ORG });

      expect(await world.openLinks()).toHaveLength(1);
    });
  });

  describe("given a person whose address a member has typed but never confirmed", () => {
    it("links nobody, since an unconfirmed address proves nothing", async () => {
      const world = buildWorld();
      await world.seedPerson();
      world.members.push(
        memberUser({
          userId: "user_42",
          name: null,
          email: "m.silva@acme.test",
          emailVerified: false,
        }),
      );

      await world.service.linkProvenMatches({ organizationId: ORG });

      expect(await world.openLinks()).toEqual([]);
    });
  });

  describe("given the directory agrees with the confirmed address", () => {
    /** @scenario "A directory identifier agreeing with the address is recorded as the stronger proof" */
    it("records the stronger proof on the link", async () => {
      const world = buildWorld();
      await world.seedPerson({ rawActorId: "ext-991", displayText: "m.silva@acme.test" });
      world.verifiedMember("user_42", "m.silva@acme.test");
      world.directoryIds.push({ userId: "user_42", externalId: "ext-991" });

      await world.service.linkProvenMatches({ organizationId: ORG });

      expect(await world.openLinks()).toEqual([
        expect.objectContaining({
          userId: "user_42",
          evidenceKind: MATCH_EVIDENCE_KIND.VERIFIED_EMAIL_AND_DIRECTORY_ID,
        }),
      ]);
    });
  });

  describe("given a person erased after the pass read them but before it wrote", () => {
    /** @scenario "A person erased while a match pass is running is not linked" */
    it("opens no link, because the read is repeated at the moment of writing", async () => {
      const world = buildWorld();
      const personId = await world.seedPerson();
      world.verifiedMember("user_42", "m.silva@acme.test");
      const people = world.repositories.discoveredPeople;
      const read = people.findMatchable.bind(people);
      vi.spyOn(people, "findMatchable").mockImplementationOnce(async (input) => {
        const rows = await read(input);
        await world.erase(personId);
        return rows;
      });

      const outcome = await world.service.linkProvenMatches({ organizationId: ORG });

      expect(await world.openLinks()).toEqual([]);
      expect(outcome.linked).toBe(0);
    });

    it("carries on with the rest of the organization rather than stopping", async () => {
      const world = buildWorld();
      const erasedId = await world.seedPerson();
      const otherId = await world.seedPerson({ rawActorId: "j.bakker@acme.test" });
      world.verifiedMember("user_42", "m.silva@acme.test");
      world.verifiedMember("user_7", "j.bakker@acme.test");
      const people = world.repositories.discoveredPeople;
      const read = people.findMatchable.bind(people);
      vi.spyOn(people, "findMatchable").mockImplementationOnce(async (input) => {
        const rows = await read(input);
        await world.erase(erasedId);
        return rows;
      });

      await world.service.linkProvenMatches({ organizationId: ORG });

      expect((await world.openLinks()).map((row) => row.discoveredPersonId)).toEqual([otherId]);
    });
  });

  describe("given a person who already holds an open link to that same account", () => {
    /** @scenario "A person who is already linked is left alone" */
    it("opens no second link and halts nobody", async () => {
      const world = buildWorld();
      await world.seedPerson();
      world.verifiedMember("user_42", "m.silva@acme.test");
      await world.service.linkProvenMatches({ organizationId: ORG });

      const outcome = await world.service.linkProvenMatches({ organizationId: ORG });

      expect(outcome).toEqual({ linked: 0, suspended: 0, unproven: 0 });
      expect(await world.openLinks()).toHaveLength(1);
    });
  });

  describe("given an address two members have both confirmed", () => {
    /** @scenario "A halt survives the next run of the matcher" */
    it("halts automatic linking for that person, links nobody, and the halt holds on the next run", async () => {
      const world = buildWorld();
      const personId = await world.seedPerson({ rawActorId: "shared@acme.test" });
      world.verifiedMember("user_42", "shared@acme.test");
      world.verifiedMember("user_77", "shared@acme.test");

      const outcome = await world.service.linkProvenMatches({ organizationId: ORG });
      const again = await world.service.linkProvenMatches({ organizationId: ORG });

      expect(outcome).toEqual({ linked: 0, suspended: 1, unproven: 0 });
      expect(again).toEqual({ linked: 0, suspended: 0, unproven: 0 });
      expect(await world.openLinks()).toEqual([]);
      const person = await world.repositories.discoveredPeople.findById({
        id: personId,
        organizationId: ORG,
      });
      expect(person).toMatchObject({
        suspendedAt: AT,
        suspendedReason: "ambiguous_verified_email",
      });
    });
  });

  describe("given a person nothing proves anything about", () => {
    it("reports them as unproven rather than treating it as a failure", async () => {
      const world = buildWorld();
      await world.seedPerson({ rawActorId: "user_opaque" });

      const outcome = await world.service.linkProvenMatches({ organizationId: ORG });

      expect(await world.openLinks()).toEqual([]);
      expect(outcome).toEqual({ linked: 0, suspended: 0, unproven: 1 });
    });
  });

  describe("given a concurrent pass that opened the same link first", () => {
    let world: ReturnType<typeof buildWorld>;
    beforeEach(async () => {
      world = buildWorld();
      await world.seedPerson();
      world.verifiedMember("user_42", "m.silva@acme.test");
    });

    it("carries on rather than ending the pass", async () => {
      vi.spyOn(world.repositories.identityMatches, "open").mockRejectedValueOnce(uniqueViolation());

      await expect(world.service.linkProvenMatches({ organizationId: ORG })).resolves.toEqual({
        linked: 0,
        suspended: 0,
        unproven: 0,
      });
    });

    it("still raises anything that is not the open-link rule", async () => {
      vi.spyOn(world.repositories.identityMatches, "open").mockRejectedValueOnce(
        new Error("the database is on fire"),
      );

      await expect(world.service.linkProvenMatches({ organizationId: ORG })).rejects.toThrow(
        "the database is on fire",
      );
    });
  });
});

describe("Feature: turning a suggestion into a link", () => {
  describe("given a stored suggestion for a person with no link", () => {
    it("opens the link on the person's say-so, not on the score, and clears the queue", async () => {
      const world = buildWorld();
      const personId = await world.seedPerson({ rawActorId: "user_opaque" });
      const suggestionId = await world.suggest(personId);

      await expect(
        world.service.confirmSuggestion({ organizationId: ORG, suggestionId }),
      ).resolves.toEqual({ discoveredPersonId: personId, userId: "user_42" });

      expect(await world.openLinks()).toEqual([
        {
          discoveredPersonId: personId,
          userId: "user_42",
          evidenceKind: MATCH_EVIDENCE_KIND.HUMAN_CONFIRMED,
        },
      ]);
      expect(await world.service.listSuggestions({ organizationId: ORG })).toEqual([]);
    });
  });

  describe("given a suggestion that has already been confirmed", () => {
    /** @scenario "Confirming a suggestion that no longer exists is refused" */
    it("refuses, naming the suggestion rather than failing anonymously", async () => {
      const world = buildWorld();

      await expect(
        world.service.confirmSuggestion({ organizationId: ORG, suggestionId: "ims_1" }),
      ).rejects.toMatchObject({ code: new IdentityMatchSuggestionNotFoundError("ims_1").code });
    });
  });

  describe("given two reviewers confirming at the same instant", () => {
    it("tells the loser the person is already linked, not that something unknown happened", async () => {
      const world = buildWorld();
      const personId = await world.seedPerson({ rawActorId: "user_opaque" });
      const suggestionId = await world.suggest(personId);
      vi.spyOn(world.repositories.identityMatches, "open").mockRejectedValueOnce(
        Object.assign(new Error("duplicate key value"), { code: "23505" }),
      );

      await expect(
        world.service.confirmSuggestion({ organizationId: ORG, suggestionId }),
      ).rejects.toMatchObject({ code: new IdentityAlreadyLinkedError(personId).code });
    });
  });

  describe("given a suggestion for a person who has since been erased", () => {
    /** @scenario "Confirming a suggestion for an erased person is refused" */
    it("refuses before it reads the open links, and opens nothing", async () => {
      const world = buildWorld();
      const personId = await world.seedPerson({ rawActorId: "user_opaque" });
      const suggestionId = await world.suggest(personId);
      await world.erase(personId);
      const findOpen = vi.spyOn(world.repositories.identityMatches, "findOpenByOrganization");

      await expect(
        world.service.confirmSuggestion({ organizationId: ORG, suggestionId }),
      ).rejects.toMatchObject({ code: new IdentityErasedError(personId).code });
      expect(findOpen).not.toHaveBeenCalled();
      findOpen.mockRestore();
      expect(await world.openLinks()).toEqual([]);
    });
  });
});

describe("Feature: reading the review queue", () => {
  it("hands back what the job stored, without scoring anything itself", async () => {
    const world = buildWorld();
    const personId = await world.seedPerson({ rawActorId: "user_opaque" });
    await world.suggest(personId);

    await expect(world.service.listSuggestions({ organizationId: ORG })).resolves.toEqual([
      expect.objectContaining({ discoveredPersonId: personId, userId: "user_42", score: 0.9 }),
    ]);
  });
});
