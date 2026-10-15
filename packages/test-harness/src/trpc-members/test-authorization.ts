import type { Authorize } from "@langwatch/api/access";
import { type Actor, type AuthorizationInput, sealAuthorization } from "@langwatch/authorization";
import { nowInstant } from "@langwatch/time";

const TEST_ORGANIZATION_ID = "test-organization";
const TEST_PROOF_LIFETIME_MS = 5 * 60 * 1000;

/** Who a test proof names, as the authorizer would: an internal actor by its code path alone. */
function principalOf(actor: Actor): AuthorizationInput["principal"] {
  switch (actor.type) {
    case "api_key":
      return { type: "apiKey", id: actor.id };
    case "internal":
      return { type: "internal", codePath: actor.codePath };
    case "system":
      return { type: "system", name: actor.name };
    case "user":
      return { type: "user", id: actor.id };
  }
}

/** The door's proof minter as a test supplies it: one own grant for the asked read. */
export const mintTestAuthorization: NonNullable<Authorize["authorization"]> = async ({
  actor,
  permission,
  projectId,
  purpose,
}) =>
  sealAuthorization({
    actor,
    principal: principalOf(actor),
    scope: { organizationId: TEST_ORGANIZATION_ID },
    grants: [{ projectId, permissions: [permission], via: [], kind: "own" }],
    expiresAt: nowInstant().epochMilliseconds + TEST_PROOF_LIFETIME_MS,
    purpose,
  });

/**
 * The `Authorize` members a test does not ask about, as an ordinary project answers them.
 * Spread first, so the members a test declares win: `{ ...testAuthorizeDefaults, getDecision }`.
 */
export const testAuthorizeDefaults = {
  organizationOf: async () => null,
  getPlatformDecision: async () => ({ permitted: false }),
  projectKindOf: async () => "application",
  authorization: mintTestAuthorization,
  assertSecondFactor: async () => {},
} satisfies Omit<Authorize, "getDecision" | "getProjectAnyDecision" | "checkScopeLineage">;

/**
 * The authorization a mounted REST router runs on in a test, mirroring
 * trpcTestMembers: the test decides each permission, and a proof-bearing read
 * is handed an own-grant proof for the asked project.
 */
export function restTestAuthorization({
  permits = () => true,
}: {
  permits?: (permission: Parameters<Authorize["getDecision"]>[0]["permission"]) => boolean;
} = {}): Readonly<{ forRequest(): Authorize }> {
  return {
    forRequest: () => ({
      ...testAuthorizeDefaults,
      getDecision: async ({ permission }) => ({
        permitted: permits(permission),
        organizationRole: null,
      }),
      getProjectAnyDecision: async ({ permissions }) => ({
        permitted: permissions.some((permission) => permits(permission)),
        organizationRole: null,
      }),
      checkScopeLineage: async () => ({ kind: "consistent" }),
    }),
  };
}
