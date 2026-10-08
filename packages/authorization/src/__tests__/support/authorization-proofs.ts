/**
 * Sealed ADR-166 proofs for tests that hand one to a store client (ADR-175). Minted through
 * `sealAuthorization`, never assembled by hand, so the client accepts them as it would a door's.
 */
import { type Authorization, sealAuthorization } from "../../authorization-proof.ts";

const TEST_ACTOR = { type: "user", id: "test-user" } as const;
const TEST_ORGANIZATION_ID = "test-organization";
const TEST_PERMISSIONS = ["traces:view", "analytics:view"] as const;
/** The same ceiling the authz minter puts on a proof. */
const TEST_PROOF_TTL_MS = 5 * 60 * 1000;

/** The proof a plain project's route mints: one own grant, nothing shared. */
export function ownProof({ projectId, now }: { projectId: string; now: number }): Authorization {
  return sealAuthorization({
    actor: TEST_ACTOR,
    principal: TEST_ACTOR,
    scope: { organizationId: TEST_ORGANIZATION_ID },
    grants: [{ projectId, permissions: [...TEST_PERMISSIONS], via: [], kind: "own" }],
    expiresAt: now + TEST_PROOF_TTL_MS,
    purpose: { kind: "route", route: "test" },
  });
}

/**
 * An aggregate's proof: own on the aggregate, one shared grant per member with the window its
 * grant opens (`until` open-ended unless given).
 */
export function aggregateProof({
  projectId,
  members,
  now,
}: {
  projectId: string;
  members: { projectId: string; from: number; until?: number | null }[];
  now: number;
}): Authorization {
  return sealAuthorization({
    actor: TEST_ACTOR,
    principal: TEST_ACTOR,
    scope: { organizationId: TEST_ORGANIZATION_ID },
    grants: [
      { projectId, permissions: [...TEST_PERMISSIONS], via: [], kind: "own" },
      ...members.map((member, index) => ({
        projectId: member.projectId,
        permissions: ["traces:view"],
        via: [`grant_${index}`],
        kind: "shared" as const,
        condition: { type: "trace" as const, from: member.from, until: member.until ?? null },
      })),
    ],
    expiresAt: now + TEST_PROOF_TTL_MS,
    purpose: { kind: "route", route: "test" },
  });
}
