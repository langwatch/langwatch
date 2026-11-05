/**
 * The proofs an analytics read runs under in a test (ADR-177): an own-project proof as the
 * platform mints it, and an aggregate's proof that also opens member projects inside windows.
 */
import {
  type Authorization,
  type AuthorizationGrant,
  internalActor,
  type ProofBearingPermission,
  sealAuthorization,
} from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";

const TEST_ORGANIZATION_ID = "test-organization";
const TEST_PROOF_LIFETIME_MS = 5 * 60 * 1000;

/** A shared member project and the window its grant opens, in epoch milliseconds. */
export type TestSharedWindow = { projectId: string; from: number; until?: number };

/**
 * A proof whose own grant is `projectId`, plus one shared trace grant per member window, minted
 * for `permission` (a series' `analytics:view` unless a cost read asks for `cost:view`). It
 * lives five minutes unless `expiresAt` says otherwise.
 */
export function analyticsProof({
  projectId,
  shared = [],
  permission = "analytics:view",
  expiresAt = nowInstant().epochMilliseconds + TEST_PROOF_LIFETIME_MS,
}: {
  projectId: string;
  shared?: readonly TestSharedWindow[];
  permission?: ProofBearingPermission;
  expiresAt?: number;
}): Authorization {
  const own: AuthorizationGrant = {
    projectId,
    permissions: [permission],
    via: [],
    kind: "own",
  };
  const members: AuthorizationGrant[] = shared.map((window) => ({
    projectId: window.projectId,
    permissions: [permission],
    via: [],
    kind: "shared",
    condition: { type: "trace", from: window.from, until: window.until ?? null },
  }));
  return sealAuthorization({
    actor: internalActor("analytics.test"),
    principal: { type: "internal", codePath: "analytics.test" },
    scope: { organizationId: TEST_ORGANIZATION_ID },
    grants: [own, ...members],
    expiresAt,
    purpose: { kind: "operator", entry: "analytics.test" },
  });
}

/** The authz peer as the analytics service asks it: an own-project proof per mint. */
export function analyticsTestAuthz(): AuthzApi {
  return createApiFixture<AuthzApi>({
    authorizeInternal: async ({ projectId }) => analyticsProof({ projectId }),
  });
}
