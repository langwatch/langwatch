// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import {
  DiscoveredPersonNotFoundError,
  type IdentityErasureDeps,
  IdentityErasureService,
} from "../identityErasure.service";
import { ERASURE_SECRET_ENV, erasureDigest } from "../logic/erasureDigest";
import {
  clearSuppressionSnapshot,
  installSuppressionSnapshot,
} from "../logic/suppressionSnapshot";

const SECRET = "a".repeat(32);
const ORG = "org_a";
const PERSON = "dp_1";
const EMAIL = "leaver@acme.test";

interface FakePerson {
  id: string;
  organizationId: string;
  provider: string;
  rawActorId: string;
  displayText: string;
  erasedAt: Date | null;
  /** Non-null means an earlier attempt removed the money rows and stopped. */
  moneyRowsPendingAt?: Date | null;
  moneyRebuildSince?: string | null;
}

/**
 * The whole erasure, wired from fakes that record what they were asked to do.
 * Every one of them is a boundary the service owns the orchestration across —
 * the point of these tests is the ORDER and the SCOPE, not the SQL.
 */
function buildService(
  overrides: {
    person?: FakePerson | null;
    days?: { tenantId: string; day: string }[];
    tenants?: string[];
    replayHorizon?: Date | null;
    /** How many times the ClickHouse delete throws before it starts working. */
    failDeleteTimes?: number;
    /** How many times the rebuild request throws before it starts working. */
    failReplayTimes?: number;
    /** Pending match suggestions the person is sitting in (ADR-128 §12). */
    pendingSuggestions?: number;
    /**
     * Links a concurrent match pass opened after the first sweep — what the
     * second sweep is there to find.
     */
    linksOpenedMidErasure?: number;
  } = {},
) {
  const failures = {
    delete: overrides.failDeleteTimes ?? 0,
    replay: overrides.failReplayTimes ?? 0,
  };
  const person: FakePerson | null =
    overrides.person === undefined
      ? {
          id: PERSON,
          organizationId: ORG,
          provider: "anthropic_admin",
          rawActorId: EMAIL,
          displayText: "Leaver Person",
          erasedAt: null,
        }
      : overrides.person;

  const calls: string[] = [];
  const recorded: {
    suppressionHashes: string[];
    pseudonym?: string;
    deletedActor?: string;
    deletedTenants?: string[];
    replayedSince?: string;
    replayedTenants?: string[];
    markedRebuildSince?: string | null;
  } = { suppressionHashes: [] };

  // Installed rather than injected: the service reaches the process's one
  // snapshot on purpose, so this is the only handle a test gets on it either.
  installSuppressionSnapshot({
    load: async () => {
      calls.push("snapshot.refresh");
      return {
        digestsByOrganization: new Map(),
        organizationByTenant: new Map(),
      };
    },
  });

  const deps: IdentityErasureDeps = {
    prisma: {} as PrismaClient,
    tenantHistory: {
      findAllByOrganization: vi
        .fn()
        .mockResolvedValue(
          (overrides.tenants ?? ["project_gov_new", "project_gov_old"]).map(
            (tenantId) => ({ tenantId }),
          ),
        ),
    } as unknown as IdentityErasureDeps["tenantHistory"],
    suppression: {
      recordAll: vi.fn(async (_client, params) => {
        calls.push("suppression.recordAll");
        recorded.suppressionHashes = params.identifierHashes;
        return params.identifierHashes.length;
      }),
    } as unknown as IdentityErasureDeps["suppression"],
    // Each write lands on the same `person` object the read returns, so a
    // second `erase()` sees what the first one actually committed. Without
    // that, a test of "the re-run resumes" would be reading the state it
    // wished for rather than the state a crash would have left.
    discoveredPeople: {
      findById: vi.fn(async () => person),
      markMoneyRowsPending: vi.fn(async (_client, params) => {
        calls.push("people.markMoneyRowsPending");
        recorded.markedRebuildSince = params.rebuildSince;
        if (person) {
          person.moneyRowsPendingAt = params.at;
          person.moneyRebuildSince = params.rebuildSince;
        }
        return 1;
      }),
      pseudonymize: vi.fn(async (_client, params) => {
        calls.push("people.pseudonymize");
        recorded.pseudonym = params.pseudonym;
        if (person) {
          person.rawActorId = params.pseudonym;
          person.displayText = params.pseudonym;
          person.erasedAt = params.erasedAt;
        }
        return 1;
      }),
      settleMoneyRows: vi.fn(async () => {
        calls.push("people.settleMoneyRows");
        if (person) {
          person.moneyRowsPendingAt = null;
          person.moneyRebuildSince = null;
        }
        return 1;
      }),
    } as unknown as IdentityErasureDeps["discoveredPeople"],
    identityMatches: {
      blankUserReferences: vi.fn(async () => {
        calls.push("matches.blank");
        // The first sweep finds the links the person actually held. The second
        // finds whatever a match pass opened while the erasure was running,
        // which on a quiet system is nothing.
        const sweep = calls.filter((label) => label === "matches.blank").length;
        return sweep === 1 ? 2 : (overrides.linksOpenedMidErasure ?? 0);
      }),
    } as unknown as IdentityErasureDeps["identityMatches"],
    matchSuggestions: {
      deleteAllForPerson: vi.fn(async () => {
        calls.push("suggestions.delete");
        return overrides.pendingSuggestions ?? 0;
      }),
    } as unknown as IdentityErasureDeps["matchSuggestions"],
    rollupErasure: {
      findDaysCarryingActor: vi
        .fn()
        .mockResolvedValue(
          overrides.days ?? [
            { tenantId: "project_gov_new", day: "2026-08-20" },
          ],
        ),
      deleteRowsCarryingActor: vi.fn(async (params) => {
        calls.push("rollup.delete");
        recorded.deletedActor = params.rawActorId;
        recorded.deletedTenants = params.tenantIds;
        if (failures.delete > 0) {
          failures.delete -= 1;
          throw new Error("ClickHouse went away mid-mutation");
        }
      }),
    } as unknown as IdentityErasureDeps["rollupErasure"],
    replay: {
      replaySince: vi.fn(async (params) => {
        calls.push("replay");
        recorded.replayedSince = params.since;
        recorded.replayedTenants = params.tenantIds;
        if (failures.replay > 0) {
          failures.replay -= 1;
          throw new Error("A replay is already running");
        }
      }),
    },
    replayHorizon: () => overrides.replayHorizon ?? null,
    now: () => new Date("2026-09-02T00:00:00.000Z"),
  };

  return { service: new IdentityErasureService(deps), deps, calls, recorded };
}

describe("given a provider-named person an organization has asked us to erase", () => {
  beforeEach(() => {
    vi.stubEnv(ERASURE_SECRET_ENV, SECRET);
  });

  afterEach(() => clearSuppressionSnapshot());

  describe("when the erasure runs", () => {
    /** @scenario "Erasing a person replaces their identifier everywhere it is stored" */
    it("suppresses the identifier, unlinks the account, and replaces the identifier in place", async () => {
      const { service, recorded, deps } = buildService();

      const outcome = await service.erase({
        organizationId: ORG,
        discoveredPersonId: PERSON,
      });

      const expected = erasureDigest({ secret: SECRET, identifier: EMAIL });
      expect(outcome.pseudonym).toBe(expected);
      expect(recorded.suppressionHashes).toContain(expected);
      expect(recorded.pseudonym).toBe(expected);
      expect(outcome.identityMatchesBlanked).toBe(2);
      expect(deps.identityMatches.blankUserReferences).toHaveBeenCalledWith(
        expect.anything(),
        { organizationId: ORG, discoveredPersonId: PERSON },
      );
    });

    it("also suppresses the displayed name, which is a second identifier", async () => {
      const { service, recorded } = buildService();

      await service.erase({ organizationId: ORG, discoveredPersonId: PERSON });

      expect(recorded.suppressionHashes).toHaveLength(2);
      expect(recorded.suppressionHashes).toContain(
        erasureDigest({ secret: SECRET, identifier: "Leaver Person" }),
      );
    });

    it("records the identifier before deleting anything, so a crash cannot re-import it", async () => {
      const { service, calls } = buildService();

      await service.erase({ organizationId: ORG, discoveredPersonId: PERSON });

      expect(calls.indexOf("suppression.recordAll")).toBeLessThan(
        calls.indexOf("rollup.delete"),
      );
    });

    it("refreshes the fold's view of the list before replaying, so the replay cannot re-derive the original", async () => {
      const { service, calls } = buildService();

      await service.erase({ organizationId: ORG, discoveredPersonId: PERSON });

      expect(calls.indexOf("snapshot.refresh")).toBeGreaterThan(
        calls.indexOf("suppression.recordAll"),
      );
      expect(calls.indexOf("snapshot.refresh")).toBeLessThan(
        calls.indexOf("replay"),
      );
    });
  });

  describe("when the person is sitting in somebody's match review queue", () => {
    /** @scenario "Erasing a person clears the match suggestions naming them" */
    it("deletes the pending suggestions and reports how many there were", async () => {
      const { service, calls } = buildService({ pendingSuggestions: 3 });

      const outcome = await service.erase({
        organizationId: ORG,
        discoveredPersonId: PERSON,
      });

      // Two sweeps by design, so the total is both. Leaving them behind was a
      // way back in: confirming one opens a fresh link on an erased person.
      expect(outcome.matchSuggestionsRemoved).toBe(6);
      expect(
        calls.filter((call) => call === "suggestions.delete"),
      ).toHaveLength(2);
    });

    it("clears them alongside the links, before the identifier is destroyed", async () => {
      const { service, calls } = buildService({ pendingSuggestions: 1 });

      await service.erase({ organizationId: ORG, discoveredPersonId: PERSON });

      // The first sweep sits with `matches.blank`: an erasure that got as far
      // as detaching the account and then died must not leave an invitation to
      // reattach it lying in a queue.
      expect(calls.indexOf("suggestions.delete")).toBeGreaterThan(
        calls.indexOf("matches.blank"),
      );
      expect(calls.indexOf("suggestions.delete")).toBeLessThan(
        calls.indexOf("people.pseudonymize"),
      );
    });

    it("sweeps again after the person is marked, catching whatever landed in between", async () => {
      const { service, calls } = buildService({ pendingSuggestions: 1 });

      await service.erase({ organizationId: ORG, discoveredPersonId: PERSON });

      // Between the first sweep and the mark, both match passes still read this
      // person as a live candidate. The second sweep is what collects anything
      // they wrote in that gap. It narrows the window rather than closing it —
      // a pass that read before the mark can still write after this line, and
      // what refuses that write is the re-read in `identityMatch.service.ts`.
      expect(calls.lastIndexOf("suggestions.delete")).toBeGreaterThan(
        calls.indexOf("people.pseudonymize"),
      );
    });
  });

  describe("when a match pass opens a link while the erasure is running", () => {
    /** @scenario "A link opened during an erasure is blanked before the erasure returns" */
    it("blanks it in the second sweep and counts it in the outcome", async () => {
      const { service, calls } = buildService({ linksOpenedMidErasure: 1 });

      const outcome = await service.erase({
        organizationId: ORG,
        discoveredPersonId: PERSON,
      });

      // Two blanked in the first sweep, one more that appeared after it. The
      // one-open-link index is no guarantee against that one — a person whose
      // links were all closed, or who had none, holds no open slot to refuse
      // it — so the second sweep is what actually catches it.
      expect(outcome.identityMatchesBlanked).toBe(3);
      expect(calls.filter((call) => call === "matches.blank")).toHaveLength(2);
    });

    it("blanks after the person is marked, not only before", async () => {
      const { service, calls } = buildService({ linksOpenedMidErasure: 1 });

      await service.erase({ organizationId: ORG, discoveredPersonId: PERSON });

      expect(calls.lastIndexOf("matches.blank")).toBeGreaterThan(
        calls.indexOf("people.pseudonymize"),
      );
    });

    it("blanks on the resumed path too, which reaches the tail by a different route", async () => {
      // An erasure that died after removing the money rows comes back through
      // `resumeMoneyRows`, and a link opened in the meantime is just as real.
      // That path used to report zero blanked no matter what it found, because
      // it never looked.
      const { service, calls } = buildService({
        person: {
          id: PERSON,
          organizationId: ORG,
          provider: "openai_admin",
          rawActorId: "erased_abc",
          displayText: "erased_abc",
          erasedAt: new Date("2026-09-01T00:00:00.000Z"),
          moneyRowsPendingAt: new Date("2026-09-01T00:00:00.000Z"),
          moneyRebuildSince: "2026-08-20",
        },
      });

      const outcome = await service.erase({
        organizationId: ORG,
        discoveredPersonId: PERSON,
      });

      expect(outcome.resumed).toBe(true);
      expect(calls).toContain("matches.blank");
      expect(outcome.identityMatchesBlanked).toBeGreaterThan(0);
    });
  });

  describe("when the organization has written under more than one governance area", () => {
    /** @scenario "Erasure reaches areas the organization no longer uses" */
    it("deletes across every area in its history, not only the current one", async () => {
      const { service, recorded } = buildService({
        tenants: ["project_gov_new", "project_gov_old"],
      });

      await service.erase({ organizationId: ORG, discoveredPersonId: PERSON });

      expect(recorded.deletedTenants).toEqual([
        "project_gov_new",
        "project_gov_old",
      ]);
      expect(recorded.deletedActor).toBe(EMAIL);
    });
  });

  describe("when some affected days are older than the history we keep", () => {
    /** @scenario "Days too old to rebuild are reported rather than passed over" */
    it("removes their rows and names the days it could not rebuild", async () => {
      const { service, recorded } = buildService({
        days: [
          { tenantId: "project_gov_new", day: "2025-01-05" },
          { tenantId: "project_gov_new", day: "2026-08-20" },
        ],
        replayHorizon: new Date("2026-06-01T00:00:00.000Z"),
      });

      const outcome = await service.erase({
        organizationId: ORG,
        discoveredPersonId: PERSON,
      });

      expect(outcome.daysNotRebuilt).toEqual([
        { tenantId: "project_gov_new", day: "2025-01-05" },
      ]);
      expect(outcome.affectedDays).toHaveLength(2);
      // The rows still go, and the replay starts at the oldest day that can
      // actually be rebuilt rather than at the one that cannot.
      expect(recorded.deletedActor).toBe(EMAIL);
      expect(recorded.replayedSince).toBe("2026-08-20");
    });
  });

  describe("when every affected day is older than the history we keep", () => {
    it("deletes the rows and does not ask for a replay that has nothing to read", async () => {
      const { service, deps } = buildService({
        days: [{ tenantId: "project_gov_new", day: "2025-01-05" }],
        replayHorizon: new Date("2026-06-01T00:00:00.000Z"),
      });

      const outcome = await service.erase({
        organizationId: ORG,
        discoveredPersonId: PERSON,
      });

      expect(outcome.daysNotRebuilt).toHaveLength(1);
      expect(deps.replay.replaySince).not.toHaveBeenCalled();
      expect(deps.rollupErasure.deleteRowsCarryingActor).toHaveBeenCalled();
    });
  });

  describe("when the person has already been erased", () => {
    /** @scenario "Erasing the same person twice changes nothing the second time" */
    it("reports the stand-in they carry and touches nothing", async () => {
      const pseudonym = erasureDigest({ secret: SECRET, identifier: EMAIL });
      const { service, deps } = buildService({
        person: {
          id: PERSON,
          organizationId: ORG,
          provider: "anthropic_admin",
          rawActorId: pseudonym,
          displayText: pseudonym,
          erasedAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      });

      const outcome = await service.erase({
        organizationId: ORG,
        discoveredPersonId: PERSON,
      });

      expect(outcome.pseudonym).toBe(pseudonym);
      expect(outcome.suppressionRowsRecorded).toBe(0);
      expect(deps.suppression.recordAll).not.toHaveBeenCalled();
      expect(deps.rollupErasure.deleteRowsCarryingActor).not.toHaveBeenCalled();
    });
  });

  describe("when the first attempt dies after removing the daily totals", () => {
    /** @scenario "An erasure interrupted after the totals were removed finishes on the next attempt" */
    it("picks the rebuild back up rather than reporting a clean erasure", async () => {
      const { service, calls, recorded } = buildService({
        failReplayTimes: 1,
      });

      await expect(
        service.erase({ organizationId: ORG, discoveredPersonId: PERSON }),
      ).rejects.toThrow("A replay is already running");
      // The rows are gone, and the day to rebuild from was written down before
      // they went — which is the only reason the next attempt can do anything.
      expect(calls).toContain("rollup.delete");
      expect(recorded.markedRebuildSince).toBe("2026-08-20");
      expect(calls).not.toContain("people.settleMoneyRows");

      const outcome = await service.erase({
        organizationId: ORG,
        discoveredPersonId: PERSON,
      });

      expect(outcome.resumed).toBe(true);
      expect(outcome.rebuiltFrom).toBe("2026-08-20");
      expect(recorded.replayedSince).toBe("2026-08-20");
      expect(calls).toContain("people.settleMoneyRows");
    });

    it("is a genuine no-op only once the rebuild has actually been asked for", async () => {
      const { service, deps } = buildService({ failReplayTimes: 1 });

      await expect(
        service.erase({ organizationId: ORG, discoveredPersonId: PERSON }),
      ).rejects.toThrow();
      await service.erase({ organizationId: ORG, discoveredPersonId: PERSON });

      const third = await service.erase({
        organizationId: ORG,
        discoveredPersonId: PERSON,
      });

      expect(third.resumed).toBe(false);
      expect(third.rebuiltFrom).toBeNull();
      // Two calls asked for a rebuild; the third found nothing outstanding.
      expect(deps.replay.replaySince).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the first attempt dies during the removal itself", () => {
    it("re-runs the whole erasure and still rebuilds the right days", async () => {
      const { service, recorded } = buildService({ failDeleteTimes: 1 });

      await expect(
        service.erase({ organizationId: ORG, discoveredPersonId: PERSON }),
      ).rejects.toThrow("ClickHouse went away mid-mutation");

      const outcome = await service.erase({
        organizationId: ORG,
        discoveredPersonId: PERSON,
      });

      // The identity was never destroyed, so this is the full path again, not a
      // resume — and the day recorded before the failed delete is still what
      // the rebuild starts from even though the rows may already be gone.
      expect(outcome.resumed).toBe(false);
      expect(outcome.rebuiltFrom).toBe("2026-08-20");
      expect(recorded.replayedSince).toBe("2026-08-20");
    });
  });

  describe("when the person belongs to another organization", () => {
    /** @scenario "A person from another organization cannot be erased" */
    it("refuses", async () => {
      const { service } = buildService({ person: null });

      await expect(
        service.erase({ organizationId: ORG, discoveredPersonId: PERSON }),
      ).rejects.toThrow(DiscoveredPersonNotFoundError);
    });
  });

  describe("when the deployment has no erasure secret", () => {
    it("refuses before writing anything", async () => {
      vi.stubEnv(ERASURE_SECRET_ENV, "");
      const { service, deps } = buildService();

      await expect(
        service.erase({ organizationId: ORG, discoveredPersonId: PERSON }),
      ).rejects.toThrow(ERASURE_SECRET_ENV);
      expect(deps.suppression.recordAll).not.toHaveBeenCalled();
      expect(deps.rollupErasure.deleteRowsCarryingActor).not.toHaveBeenCalled();
    });
  });
});
