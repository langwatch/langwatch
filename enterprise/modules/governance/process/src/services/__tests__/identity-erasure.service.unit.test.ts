// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  DiscoveredPersonNotFoundError,
  ErasureSecretMissingError,
} from "@langwatch/enterprise-governance-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { type Instant, Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { MemoryRollupErasureRepository } from "../../repositories/memory/memory.rollup-erasure.repository.ts";
import { erasureDigest } from "../../rules/erasure-digest.rules.ts";
import { IdentityErasureService, type RollupReplay } from "../identity-erasure.service.ts";
import { SuppressionSnapshotService } from "../suppression-snapshot.service.ts";

const SECRET = "a".repeat(32);
const ORG = "org_a";
const EMAIL = "leaver@acme.test";
const NOW = Temporal.Instant.from("2026-09-02T00:00:00Z");

/** Real memory twins throughout; spies only observe order, except where a test injects a crash. */
async function buildWorld(
  options: {
    days?: string[];
    tenants?: string[];
    replayHorizon?: Instant;
    pendingSuggestions?: number;
    erasureSecret?: string;
    /** False for a person who held no link, which is the only one a match pass can link mid-erasure. */
    linked?: boolean;
    duringReplay?: (context: { personId: string }) => Promise<void>;
  } = {},
) {
  const repositories = MemoryGovernanceRepositories.create();
  const rollupErasure = MemoryRollupErasureRepository.create();
  const tenants = options.tenants ?? ["project_gov_new", "project_gov_old"];
  for (const [index, tenantId] of tenants.entries()) {
    await repositories.tenantHistory.append({
      organizationId: ORG,
      tenantId,
      at: NOW.subtract({ hours: tenants.length - index }),
    });
  }
  await repositories.discoveredPeople.recordDirectorySighting({
    organizationId: ORG,
    provider: "anthropic_admin",
    rawActorId: EMAIL,
    displayText: "Leaver Person",
    department: "",
    seenAt: NOW.subtract({ hours: 48 }),
  });
  const [person] = await repositories.discoveredPeople.findByOrganization({ organizationId: ORG });
  if (!person) throw new Error("the seeded person is missing");
  const personId = person.id;

  if (options.linked ?? true) {
    await repositories.identityMatches.open({
      organizationId: ORG,
      discoveredPersonId: personId,
      userId: "user_1",
      evidenceKind: "verified_email",
      validFrom: NOW.subtract({ hours: 24 }),
    });
  }
  await repositories.identityMatchSuggestions.replaceForOrganization({
    organizationId: ORG,
    suggestions: Array.from({ length: options.pendingSuggestions ?? 0 }, (_, index) => ({
      discoveredPersonId: personId,
      userId: `user_suggested_${index}`,
      score: 0.9,
    })),
    computedAt: NOW,
  });
  for (const day of options.days ?? ["2026-08-20"]) {
    rollupErasure.rollupRows.push({ tenantId: "project_gov_new", day, rawActorId: EMAIL });
  }
  rollupErasure.restatementRows.push({
    tenantId: "project_gov_new",
    day: "2026-08-20",
    rawActorId: EMAIL,
  });

  const load = vi.fn(async () => ({
    digestsByOrganization: new Map(),
    organizationByTenant: new Map(),
  }));
  const replaySince = vi.fn(async (_input: { tenantIds: string[]; since: string }) => {
    await options.duringReplay?.({ personId });
  });
  const replay: RollupReplay = { replaySince };
  const { logger, lines } = createTestLogger();
  const service = IdentityErasureService.create({
    ...repositories,
    suppressions: repositories.erasedIdentifierSuppressions,
    matchSuggestions: repositories.identityMatchSuggestions,
    rollupErasure,
    replay,
    suppressionSnapshot: SuppressionSnapshotService.create({ load }),
    replayHorizon: () => options.replayHorizon ?? null,
    erasureSecret: "erasureSecret" in options ? options.erasureSecret : SECRET,
    now: () => NOW,
    logger,
  });
  return { service, repositories, rollupErasure, replaySince, load, lines, personId };
}

function orderOf(spy: { mock: { invocationCallOrder: number[] } }): number {
  return spy.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
}

describe("given a provider-named person an organization has asked us to erase", () => {
  describe("when the erasure runs", () => {
    /** @scenario "Erasing a person replaces their identifier everywhere it is stored" */
    it("suppresses the identifier, unlinks the account, and replaces the identifier in place", async () => {
      const { service, repositories, rollupErasure, personId } = await buildWorld();

      const outcome = await service.erase({ organizationId: ORG, discoveredPersonId: personId });

      const expected = erasureDigest({ secret: SECRET, identifier: EMAIL });
      expect(outcome.pseudonym).toBe(expected);
      const suppressed = await repositories.erasedIdentifierSuppressions.findAllByOrganization({
        organizationId: ORG,
      });
      expect(suppressed.map((row) => row.identifierHash)).toContain(expected);
      const person = await repositories.discoveredPeople.findById({
        id: personId,
        organizationId: ORG,
      });
      expect(person).toMatchObject({
        rawActorId: expected,
        displayText: expected,
        department: null,
      });
      expect(rollupErasure.restatementRows[0]?.rawActorId).toBe(expected);
      expect(outcome.identityMatchesBlanked).toBe(1);
      const links = await repositories.identityMatches.findAllByDiscoveredPerson({
        organizationId: ORG,
        discoveredPersonId: personId,
      });
      expect(links.every((link) => link.userId === null)).toBe(true);
    });

    it("also suppresses the displayed name, which is a second identifier", async () => {
      const { service, repositories, personId } = await buildWorld();

      await service.erase({ organizationId: ORG, discoveredPersonId: personId });

      const suppressed = await repositories.erasedIdentifierSuppressions.findAll();
      expect(suppressed).toHaveLength(2);
      expect(suppressed.map((row) => row.identifierHash)).toContain(
        erasureDigest({ secret: SECRET, identifier: "Leaver Person" }),
      );
    });

    it("records the identifier before deleting anything, so a crash cannot re-import it", async () => {
      const { service, repositories, rollupErasure, personId } = await buildWorld();
      const recordAll = vi.spyOn(repositories.erasedIdentifierSuppressions, "recordAll");
      const deleteRows = vi.spyOn(rollupErasure, "deleteRowsCarryingActor");

      await service.erase({ organizationId: ORG, discoveredPersonId: personId });

      expect(orderOf(recordAll)).toBeLessThan(orderOf(deleteRows));
    });

    it("refreshes the fold's view of the list before replaying, so the replay cannot re-derive the original", async () => {
      const { service, repositories, replaySince, load, personId } = await buildWorld();
      const recordAll = vi.spyOn(repositories.erasedIdentifierSuppressions, "recordAll");

      await service.erase({ organizationId: ORG, discoveredPersonId: personId });

      expect(orderOf(load)).toBeGreaterThan(orderOf(recordAll));
      expect(orderOf(load)).toBeLessThan(orderOf(replaySince));
    });
  });

  describe("when the person is sitting in somebody's match review queue", () => {
    /** @scenario "Erasing a person clears the match suggestions naming them" */
    it("deletes the pending suggestions and reports how many there were", async () => {
      const { service, repositories, personId } = await buildWorld({ pendingSuggestions: 3 });

      const outcome = await service.erase({ organizationId: ORG, discoveredPersonId: personId });

      expect(outcome.matchSuggestionsRemoved).toBe(3);
      await expect(
        repositories.identityMatchSuggestions.findAllByOrganization({ organizationId: ORG }),
      ).resolves.toEqual([]);
    });

    it("clears them alongside the links, before the identifier is destroyed", async () => {
      const { service, repositories, personId } = await buildWorld({ pendingSuggestions: 1 });
      const blank = vi.spyOn(repositories.identityMatches, "blankUserReferences");
      const deleteSuggestions = vi.spyOn(
        repositories.identityMatchSuggestions,
        "deleteAllForPerson",
      );
      const pseudonymize = vi.spyOn(repositories.discoveredPeople, "pseudonymize");

      await service.erase({ organizationId: ORG, discoveredPersonId: personId });

      expect(orderOf(deleteSuggestions)).toBeGreaterThan(orderOf(blank));
      expect(orderOf(deleteSuggestions)).toBeLessThan(orderOf(pseudonymize));
    });

    it("sweeps again after the person is marked, catching whatever landed in between", async () => {
      const { service, repositories, personId } = await buildWorld({
        pendingSuggestions: 1,
        duringReplay: async ({ personId: id }) => {
          await repositories.identityMatchSuggestions.replaceForOrganization({
            organizationId: ORG,
            suggestions: [{ discoveredPersonId: id, userId: "user_late", score: 0.8 }],
            computedAt: NOW,
          });
        },
      });

      const outcome = await service.erase({ organizationId: ORG, discoveredPersonId: personId });

      expect(outcome.matchSuggestionsRemoved).toBe(2);
      await expect(
        repositories.identityMatchSuggestions.findAllByOrganization({ organizationId: ORG }),
      ).resolves.toEqual([]);
    });
  });

  describe("when a match pass opens a link while the erasure is running", () => {
    /** @scenario "A link opened during an erasure is blanked before the erasure returns" */
    it("blanks it in the second sweep, counts it, and says so", async () => {
      const { service, repositories, lines, personId } = await buildWorld({
        linked: false,
        duringReplay: async ({ personId: id }) => {
          await repositories.identityMatches.open({
            organizationId: ORG,
            discoveredPersonId: id,
            userId: "user_2",
            evidenceKind: "verified_email",
            validFrom: NOW,
          });
        },
      });

      const outcome = await service.erase({ organizationId: ORG, discoveredPersonId: personId });

      expect(outcome.identityMatchesBlanked).toBe(1);
      expect(lines.findLine("warn", "opened on a person mid-erasure")).toBeDefined();
      const links = await repositories.identityMatches.findOpenByOrganization({
        organizationId: ORG,
      });
      expect(links).toEqual([]);
    });
  });

  describe("when the organization has written under more than one governance area", () => {
    /** @scenario "Erasure reaches areas the organization no longer uses" */
    it("deletes across every area in its history, not only the current one", async () => {
      const { service, rollupErasure, personId } = await buildWorld({
        tenants: ["project_gov_new", "project_gov_old"],
      });
      rollupErasure.rollupRows.push({
        tenantId: "project_gov_old",
        day: "2026-08-21",
        rawActorId: EMAIL,
      });
      const deleteRows = vi.spyOn(rollupErasure, "deleteRowsCarryingActor");

      await service.erase({ organizationId: ORG, discoveredPersonId: personId });

      expect(deleteRows).toHaveBeenCalledWith({
        tenantIds: ["project_gov_new", "project_gov_old"],
        rawActorId: EMAIL,
      });
      expect(rollupErasure.rollupRows).toEqual([]);
    });
  });

  describe("when some affected days are older than the history we keep", () => {
    /** @scenario "Days too old to rebuild are reported rather than passed over" */
    it("removes their rows and names the days it could not rebuild", async () => {
      const { service, replaySince, rollupErasure, personId } = await buildWorld({
        days: ["2025-01-05", "2026-08-20"],
        replayHorizon: Temporal.Instant.from("2026-06-01T00:00:00Z"),
      });

      const outcome = await service.erase({ organizationId: ORG, discoveredPersonId: personId });

      expect(outcome.daysNotRebuilt).toEqual([{ tenantId: "project_gov_new", day: "2025-01-05" }]);
      expect(outcome.affectedDays).toHaveLength(2);
      expect(rollupErasure.rollupRows).toEqual([]);
      expect(replaySince).toHaveBeenCalledWith({
        tenantIds: ["project_gov_new", "project_gov_old"],
        since: "2026-08-20",
      });
    });
  });

  describe("when every affected day is older than the history we keep", () => {
    it("deletes the rows and does not ask for a replay that has nothing to read", async () => {
      const { service, replaySince, rollupErasure, personId } = await buildWorld({
        days: ["2025-01-05"],
        replayHorizon: Temporal.Instant.from("2026-06-01T00:00:00Z"),
      });

      const outcome = await service.erase({ organizationId: ORG, discoveredPersonId: personId });

      expect(outcome.daysNotRebuilt).toHaveLength(1);
      expect(replaySince).not.toHaveBeenCalled();
      expect(rollupErasure.rollupRows).toEqual([]);
    });
  });

  describe("when the person has already been erased", () => {
    /** @scenario "Erasing the same person twice changes nothing the second time" */
    it("reports the stand-in they carry and touches nothing", async () => {
      const { service, repositories, rollupErasure, personId } = await buildWorld();
      await service.erase({ organizationId: ORG, discoveredPersonId: personId });
      const recordAll = vi.spyOn(repositories.erasedIdentifierSuppressions, "recordAll");
      const deleteRows = vi.spyOn(rollupErasure, "deleteRowsCarryingActor");

      const outcome = await service.erase({ organizationId: ORG, discoveredPersonId: personId });

      expect(outcome.pseudonym).toBe(erasureDigest({ secret: SECRET, identifier: EMAIL }));
      expect(outcome.suppressionRowsRecorded).toBe(0);
      expect(outcome.resumed).toBe(false);
      expect(recordAll).not.toHaveBeenCalled();
      expect(deleteRows).not.toHaveBeenCalled();
    });
  });

  describe("when the first attempt dies after removing the daily totals", () => {
    /** @scenario "An erasure interrupted after the totals were removed finishes on the next attempt" */
    it("picks the rebuild back up rather than reporting a clean erasure", async () => {
      const { service, repositories, replaySince, rollupErasure, personId } = await buildWorld();
      replaySince.mockRejectedValueOnce(new Error("A replay is already running"));

      await expect(
        service.erase({ organizationId: ORG, discoveredPersonId: personId }),
      ).rejects.toThrow("A replay is already running");
      expect(rollupErasure.rollupRows).toEqual([]);
      const interrupted = await repositories.discoveredPeople.findById({
        id: personId,
        organizationId: ORG,
      });
      expect(interrupted?.moneyRebuildSince).toBe("2026-08-20");
      expect(interrupted?.moneyRowsPendingAt).not.toBeNull();

      const outcome = await service.erase({ organizationId: ORG, discoveredPersonId: personId });

      expect(outcome.resumed).toBe(true);
      expect(outcome.rebuiltFrom).toBe("2026-08-20");
      expect(replaySince).toHaveBeenLastCalledWith({
        tenantIds: ["project_gov_new", "project_gov_old"],
        since: "2026-08-20",
      });
      const settled = await repositories.discoveredPeople.findById({
        id: personId,
        organizationId: ORG,
      });
      expect(settled?.moneyRowsPendingAt).toBeNull();
    });

    it("is a genuine no-op only once the rebuild has actually been asked for", async () => {
      const { service, replaySince, personId } = await buildWorld();
      replaySince.mockRejectedValueOnce(new Error("A replay is already running"));

      await expect(
        service.erase({ organizationId: ORG, discoveredPersonId: personId }),
      ).rejects.toThrow("A replay is already running");
      await service.erase({ organizationId: ORG, discoveredPersonId: personId });
      const third = await service.erase({ organizationId: ORG, discoveredPersonId: personId });

      expect(third.resumed).toBe(false);
      expect(third.rebuiltFrom).toBeNull();
      expect(replaySince).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the first attempt dies during the removal itself", () => {
    it("re-runs the whole erasure and still rebuilds the right days", async () => {
      const { service, replaySince, rollupErasure, personId } = await buildWorld();
      vi.spyOn(rollupErasure, "deleteRowsCarryingActor").mockRejectedValueOnce(
        new Error("ClickHouse went away mid-mutation"),
      );

      await expect(
        service.erase({ organizationId: ORG, discoveredPersonId: personId }),
      ).rejects.toThrow("ClickHouse went away mid-mutation");
      const outcome = await service.erase({ organizationId: ORG, discoveredPersonId: personId });

      expect(outcome.resumed).toBe(false);
      expect(outcome.rebuiltFrom).toBe("2026-08-20");
      expect(replaySince).toHaveBeenCalledWith({
        tenantIds: ["project_gov_new", "project_gov_old"],
        since: "2026-08-20",
      });
    });
  });

  describe("when the person belongs to another organization", () => {
    /** @scenario "A person from another organization cannot be erased" */
    it("refuses", async () => {
      const { service, personId } = await buildWorld();

      await expect(
        service.erase({ organizationId: "org_b", discoveredPersonId: personId }),
      ).rejects.toThrow(DiscoveredPersonNotFoundError);
    });
  });

  describe("when the deployment has no erasure secret", () => {
    it("refuses before writing anything", async () => {
      const { service, repositories, rollupErasure, personId } = await buildWorld({
        erasureSecret: "",
      });
      const deleteRows = vi.spyOn(rollupErasure, "deleteRowsCarryingActor");

      await expect(
        service.erase({ organizationId: ORG, discoveredPersonId: personId }),
      ).rejects.toThrow(ErasureSecretMissingError);
      await expect(repositories.erasedIdentifierSuppressions.findAll()).resolves.toEqual([]);
      expect(deleteRows).not.toHaveBeenCalled();
    });
  });
});
