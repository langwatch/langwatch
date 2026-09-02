// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The one thing that makes an erasure of the money rows hold: an erasure must
 * change what the FOLD writes, in the same process, without anything being
 * passed between them.
 *
 * Erasure deletes the rows carrying an identifier and replays the days. If the
 * fold's substitution is not live by the time that replay runs, the replay
 * re-derives the erased address from the raw event log and writes it straight
 * back — and the erasure returns a clean outcome while it happens. That is not
 * a partial failure; it is a GDPR erasure that reports success and erases
 * nothing.
 *
 * So this drives the real service and then asks the real fold, through the
 * production install path and the process's one snapshot. Nothing here
 * fabricates a snapshot: if the composition root stopped calling
 * `installGovernanceSuppressionSnapshot`, the same shape of hole reopens, and
 * the negative-control case below is what it looks like.
 *
 * Spec: specs/governance/governance-identity-and-erasure.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import {
  decodeGovernanceCostRollupKey,
  governanceCostRollupKey,
} from "../../projections/governanceCostRollup.foldProjection";
import {
  DiscoveredPersonRepository,
  ErasedIdentifierSuppressionRepository,
  GovernanceTenantHistoryRepository,
  IdentityMatchRepository,
} from "../../repositories/governanceIdentity.repository";
import { installGovernanceSuppressionSnapshot } from "../erasureSuppression.service";
import { IdentityErasureService } from "../identityErasure.service";
import { resetErasureSecretCache } from "../logic/erasedActorId";
import { ERASURE_SECRET_ENV, erasureDigest } from "../logic/erasureDigest";
import { clearSuppressionSnapshot } from "../logic/suppressionSnapshot";

const SECRET = "a".repeat(32);
const ORG = "org_acme";
const TENANT = "project_gov_acme";
const PERSON = "dp_leaver";
const ERASED = "leaver@acme.test";
const STAYS = "stays@acme.test";

/**
 * Postgres, in memory, holding only the four tables this path touches.
 *
 * A double rather than a mock: the erasure writes rows and the snapshot loader
 * reads them back, and a mock returning canned values would prove the two
 * halves agree with the test instead of with each other.
 */
function inMemoryPrisma() {
  const suppressions: {
    organizationId: string;
    provider: string;
    identifierHash: string;
  }[] = [];
  const people = [
    {
      id: PERSON,
      organizationId: ORG,
      provider: "anthropic_admin",
      rawActorId: ERASED,
      displayText: ERASED,
      erasedAt: null as Date | null,
    },
  ];
  const tenants = [{ organizationId: ORG, tenantId: TENANT }];

  return {
    erasedIdentifierSuppression: {
      findMany: async ({
        where,
      }: {
        where?: { organizationId?: string };
      } = {}) =>
        suppressions.filter(
          (row) =>
            !where?.organizationId ||
            row.organizationId === where.organizationId,
        ),
      createMany: async ({
        data,
      }: {
        data: {
          organizationId: string;
          provider: string;
          identifierHash: string;
        }[];
      }) => {
        let count = 0;
        for (const row of data) {
          const exists = suppressions.some(
            (existing) =>
              existing.organizationId === row.organizationId &&
              existing.provider === row.provider &&
              existing.identifierHash === row.identifierHash,
          );
          if (exists) continue;
          suppressions.push(row);
          count += 1;
        }
        return { count };
      },
    },
    governanceTenantHistory: {
      findMany: async () => tenants,
    },
    discoveredPerson: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        people.find((person) => person.id === where.id) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { rawActorId: string; displayText: string; erasedAt: Date };
      }) => {
        const person = people.find((candidate) => candidate.id === where.id);
        if (!person) return { count: 0 };
        Object.assign(person, data);
        return { count: 1 };
      },
    },
    identityMatch: {
      updateMany: async () => ({ count: 1 }),
    },
  } as unknown as PrismaClient;
}

/** One priced gateway outcome, keyed on whoever spent the money. */
function spendEvent(principalUserId: string) {
  return {
    type: "lw.gateway.spend.confirmed",
    tenantId: TENANT,
    data: {
      occurred_at: Date.UTC(2026, 7, 20),
      model: "openai/gpt-5-mini",
      model_provider_id: "openai",
      principal_user_id: principalUserId,
      end_user_id: "",
    } as Record<string, unknown>,
  };
}

/** The actor id the real fold would address a money row under. */
function actorTheFoldWouldWrite(principalUserId: string): string {
  return decodeGovernanceCostRollupKey(
    governanceCostRollupKey(spendEvent(principalUserId)),
  ).rawActorId;
}

function buildErasure(prisma: PrismaClient) {
  return new IdentityErasureService({
    prisma,
    tenantHistory: new GovernanceTenantHistoryRepository(),
    suppression: new ErasedIdentifierSuppressionRepository(),
    discoveredPeople: new DiscoveredPersonRepository(),
    identityMatches: new IdentityMatchRepository(),
    rollupErasure: {
      findDaysCarryingActor: async () => [
        { tenantId: TENANT, day: "2026-08-20" },
      ],
      deleteRowsCarryingActor: async () => {},
    } as never,
    // The replay is where the danger lives, so this asks the question the
    // replay would ask, at the moment the replay would ask it.
    replay: {
      replaySince: async () => {
        replayObserved = actorTheFoldWouldWrite(ERASED);
      },
    },
    replayHorizon: () => null,
  });
}

let replayObserved: string | null = null;

describe("given an erasure that has to change what the money fold writes", () => {
  beforeEach(() => {
    vi.stubEnv(ERASURE_SECRET_ENV, SECRET);
    resetErasureSecretCache();
    clearSuppressionSnapshot();
    replayObserved = null;
  });

  afterEach(() => {
    clearSuppressionSnapshot();
    resetErasureSecretCache();
  });

  describe("when the process was wired the way the composition root wires it", () => {
    /** @scenario "The rebuilt money rows carry the stand-in, not the identifier" */
    it("writes the stand-in for the erased spender and leaves everyone else alone", async () => {
      const prisma = inMemoryPrisma();
      installGovernanceSuppressionSnapshot(prisma);

      const outcome = await buildErasure(prisma).erase({
        organizationId: ORG,
        discoveredPersonId: PERSON,
      });

      expect(actorTheFoldWouldWrite(ERASED)).toBe(outcome.pseudonym);
      expect(actorTheFoldWouldWrite(ERASED)).not.toBe(ERASED);
      expect(actorTheFoldWouldWrite(STAYS)).toBe(STAYS);
    });

    /** @scenario "The rebuild the erasure asks for cannot re-derive the identifier" */
    it("has the substitution live by the time it asks for the rebuild", async () => {
      const prisma = inMemoryPrisma();
      installGovernanceSuppressionSnapshot(prisma);

      const outcome = await buildErasure(prisma).erase({
        organizationId: ORG,
        discoveredPersonId: PERSON,
      });

      // Sampled inside the replay call, not after it: a substitution that only
      // becomes live once the erasure returns is a substitution the replay it
      // triggered ran without.
      expect(replayObserved).toBe(outcome.pseudonym);
      expect(replayObserved).not.toBe(ERASED);
    });
  });

  describe("when nothing installed this process's view of the erasure list", () => {
    it("writes the erased identifier straight back, which is why the wiring is not optional", async () => {
      const prisma = inMemoryPrisma();
      // Deliberately no install — the state every process was in before the
      // composition root wired one, and the reason this test exists.
      const outcome = await buildErasure(prisma).erase({
        organizationId: ORG,
        discoveredPersonId: PERSON,
      });

      expect(actorTheFoldWouldWrite(ERASED)).toBe(ERASED);
      expect(outcome.pseudonym).toBe(
        erasureDigest({ secret: SECRET, identifier: ERASED }),
      );
    });
  });
});
