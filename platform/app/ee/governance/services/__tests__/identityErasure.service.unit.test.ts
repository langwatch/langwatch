// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import {
  DiscoveredPersonNotFoundError,
  type IdentityErasureDeps,
  IdentityErasureService,
} from "../identityErasure.service";
import { ERASURE_SECRET_ENV, erasureDigest } from "../logic/erasureDigest";
import { SuppressionSnapshot } from "../logic/suppressionSnapshot";

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
  } = {},
) {
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
  } = { suppressionHashes: [] };

  const snapshot = new SuppressionSnapshot(async () => {
    calls.push("snapshot.refresh");
    return {
      digestsByOrganization: new Map(),
      organizationByTenant: new Map(),
    };
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
    discoveredPeople: {
      findById: vi.fn().mockResolvedValue(person),
      pseudonymize: vi.fn(async (_client, params) => {
        calls.push("people.pseudonymize");
        recorded.pseudonym = params.pseudonym;
        return 1;
      }),
    } as unknown as IdentityErasureDeps["discoveredPeople"],
    identityMatches: {
      blankUserReferences: vi.fn(async () => {
        calls.push("matches.blank");
        return 2;
      }),
    } as unknown as IdentityErasureDeps["identityMatches"],
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
      }),
    } as unknown as IdentityErasureDeps["rollupErasure"],
    replay: {
      replaySince: vi.fn(async (params) => {
        calls.push("replay");
        recorded.replayedSince = params.since;
        recorded.replayedTenants = params.tenantIds;
      }),
    },
    snapshot,
    replayHorizon: () => overrides.replayHorizon ?? null,
    now: () => new Date("2026-09-02T00:00:00.000Z"),
  };

  return { service: new IdentityErasureService(deps), deps, calls, recorded };
}

describe("given a provider-named person an organization has asked us to erase", () => {
  beforeEach(() => {
    vi.stubEnv(ERASURE_SECRET_ENV, SECRET);
  });

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
