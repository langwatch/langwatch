/**
 * ADR-092 §10 — offboarding, one transaction with a postcondition. Split out
 * of GrantsService because it is a different shape of work from the four
 * binding verbs: the repository deletes every grant source for the user and
 * calls back with a transaction-bound reader, and re-collecting through that
 * reader proves the effective set resolves to nothing INSIDE the transaction.
 * Anything left rolls the whole thing back.
 *
 * GrantsService keeps the epoch bump; this module owns the flow, the proof,
 * and the manifest.
 */
import { HandledError } from "@langwatch/handled-error";
import type { AuthzCollectorService } from "./authz-collector.service";
import type {
  AuthzGrantsRepository,
  LedgerActor,
  OffboardCounts,
} from "./authz-grants.repository";
import type { AuthzReadRepository } from "./authz-read.repository";

export class OffboardIncompleteError extends HandledError {
  constructor(meta: Record<string, unknown> = {}) {
    super(
      "offboard_incomplete",
      "This member still resolves permissions, so nothing was changed. Try removing them again.",
      // fault: the proof failing means OUR deletes missed a grant source -
      // a platform defect, never something the admin did wrong. What
      // exactly was left behind goes in meta and the log line, not in the
      // sentence the admin reads.
      { httpStatus: 500, fault: "platform", meta },
    );
    this.name = "OffboardIncompleteError";
  }
}

export type OffboardResult = {
  removed: OffboardCounts;
  needsHumanDecision: {
    ownedApiKeys: Array<{ id: string; name: string }>;
    personalTeams: Array<{ id: string; name: string }>;
  };
};

/**
 * Run the offboarding transaction and gather the manifest of what still
 * needs a human decision. Throws OffboardIncompleteError - and leaves
 * storage untouched - when the proof finds anything still resolving.
 */
export async function offboardUserFromOrganization({
  repository,
  collectorFor,
  actor,
  userId,
  organizationId,
}: {
  repository: AuthzGrantsRepository;
  collectorFor: (reader: AuthzReadRepository) => AuthzCollectorService;
  actor: LedgerActor;
  userId: string;
  organizationId: string;
}): Promise<OffboardResult> {
  const removed = await repository.offboardUser({
    userId,
    organizationId,
    actor,
    prove: (txReader) =>
      proveNothingResolves({
        collector: collectorFor(txReader),
        userId,
        organizationId,
      }),
  });

  const [ownedApiKeys, personalTeams] = await Promise.all([
    repository.findOwnedApiKeys({ userId, organizationId }),
    repository.findPersonalTeams({ userId, organizationId }),
  ]);

  return { removed, needsHumanDecision: { ownedApiKeys, personalTeams } };
}

/**
 * The proof (§10 step 7): re-collect against the transaction — the deletes
 * are visible there — and fail loudly if anything still resolves. Group- or
 * key-held grants cannot survive for this user: memberships are gone, and a
 * personal key is ceilinged by an owner who now resolves to nothing
 * (AuthzService applies that ceiling on every check).
 *
 * WHICH head the re-collect reads is the repository's business, not this
 * function's, and since the per-organization cutover (delivery-plan PR 3) the
 * app binds a cutover-aware reader to the transaction so the proof is made
 * against the head the organization is actually served from. It means the same
 * thing either way: a revocation names GRANT ids, and the compat row shares
 * the grant's id, so removing one head removes both.
 */
async function proveNothingResolves({
  collector,
  userId,
  organizationId,
}: {
  collector: AuthzCollectorService;
  userId: string;
  organizationId: string;
}): Promise<void> {
  const grants = await collector.collectGrants({
    principal: { type: "user", id: userId },
    organizationId,
  });
  if (
    grants.isOrgMember ||
    grants.bindings.length > 0 ||
    grants.legacyTeamMemberships.length > 0
  ) {
    throw new OffboardIncompleteError({
      userId,
      organizationId,
      remainingBindings: grants.bindings.length,
      remainingLegacyRows: grants.legacyTeamMemberships.length,
      stillOrgMember: grants.isOrgMember,
    });
  }
}
