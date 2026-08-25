// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A removal, and what it has to prove (D08).
 *
 * A deprovision is the highest-stakes thing a directory does, because the
 * customer's reason for doing it is usually that somebody left under a
 * cloud. "We deleted some rows" is not an answer; the postcondition is. So
 * every removal goes through `GrantsService.offboard` — the SERVICE, whose
 * transaction re-collects the person's effective permissions inside itself
 * and rolls the whole thing back if anything still resolves — and never at
 * the ledger writer underneath it, which is what the previous code called
 * and which is why the proof had no production call site at all.
 *
 * TWO PATHS, ONE PROOF. A directory removes somebody by deleting them or by
 * pushing them inactive, and until D08 only the first did anything to their
 * grants: `active: false` set `deactivatedAt` and left every grant standing.
 * Deactivation does block sign-in and API-key verification, so that was
 * LATENT authority rather than an open door — but latent authority comes
 * back without a decision, and reactivating somebody handed them everything
 * they held on the day they left. Both paths run this now, so coming back is
 * re-entry rather than undo.
 *
 * WHAT NEEDS A PERSON is answered, not guessed at. Offboarding returns a
 * manifest of the things a machine must not decide — API keys the leaver
 * owned, personal teams they held — and those are surfaced for an
 * administrator while their ACCESS is removed and proved empty regardless.
 *
 * FAILURE IS LOUD. A proof that still finds something resolving throws
 * `offboard_incomplete`, nothing changes, and the failure is recorded on the
 * connection's sync as a dead letter naming the person and the operation.
 * The one thing never done here is reporting the directory's requested state
 * as reached.
 *
 * See specs/identity/scim-connection-sync.feature and
 * specs/features/scim-group-mapping.feature.
 */
import { SYSTEM_ACTORS } from "@langwatch/actor";
import type { GrantsService } from "@langwatch/authz-server";
import { HandledError } from "@langwatch/handled-error";
import type { ScimApplyOp } from "@langwatch/identity";
import { createLogger } from "@langwatch/observability";
import type { ScimSyncLifecycle } from "./scim-sync.service";

const logger = createLogger("langwatch:scim:deprovision");

/** The directory acts as itself. One principal, every connection. */
const SCIM_ACTOR = { type: "system", name: "scim" } as const;

/**
 * What still needs a human decision once somebody's access is gone. Named
 * rather than acted on: transferring an API key or a personal team is a
 * choice with consequences a directory push cannot see.
 */
export type ScimRemovalManifest = {
  ownedApiKeys: Array<{ id: string; name: string }>;
  personalTeams: Array<{ id: string; name: string }>;
};

export interface ScimDeprovisionDeps {
  grants: GrantsService;
  syncLifecycle: ScimSyncLifecycle;
}

export class ScimDeprovisionService {
  constructor(private readonly deps: ScimDeprovisionDeps) {}

  /**
   * Remove every grant this person holds in the organization and prove
   * nothing resolves for them afterwards.
   *
   * Throws whatever the proof throws. The caller answers the identity
   * provider a failure — never a success, and never a silent retry.
   */
  async removeAccess({
    userId,
    organizationId,
    connectionId,
    op,
  }: {
    userId: string;
    organizationId: string;
    connectionId: string | null;
    /** Which removal this was, so the failure surface can say. */
    op: Extract<ScimApplyOp, "delete_user" | "deactivate_user">;
  }): Promise<ScimRemovalManifest> {
    try {
      const { needsHumanDecision } = await this.deps.grants.offboard({
        actor: SCIM_ACTOR,
        userId,
        organizationId,
      });
      this.reportManifest({ userId, organizationId, needsHumanDecision });
      return needsHumanDecision;
    } catch (error) {
      await this.recordFailure({
        organizationId,
        connectionId,
        op,
        userId,
        error,
      });
      throw error;
    }
  }

  /**
   * State the failure on the connection's sync so it is visible with the
   * connection, the operation and a reason code.
   *
   * `retryable` follows the error's OWN fault: a platform fault — which is
   * what an incomplete proof is — could plausibly succeed on the identity
   * provider's next attempt, so it backs off and the guard retires it once
   * the provider has retried the identical failure enough times. Anything we
   * cannot name is retryable too: retiring an unrecognised failure would
   * stop trying at a problem we have not understood.
   */
  private async recordFailure({
    organizationId,
    connectionId,
    op,
    userId,
    error,
  }: {
    organizationId: string;
    connectionId: string | null;
    op: Extract<ScimApplyOp, "delete_user" | "deactivate_user">;
    userId: string;
    error: unknown;
  }): Promise<void> {
    if (!connectionId) return;
    const handled = error instanceof HandledError ? error : null;
    await this.deps.syncLifecycle.applyFailed({
      organizationId,
      connectionId,
      op,
      // A stable slug, never the error's prose: this reaches a customer's
      // failure surface, and prose is where a hostname arrives from.
      errorCode: handled?.code ?? "unknown",
      retryable: handled?.fault !== "customer",
      userId,
    });
  }

  /**
   * Log what an administrator has to decide about. The removal itself has
   * already succeeded and been proved by the time this runs, so this is
   * never a reason to fail: an ownership transfer nobody has made yet is not
   * retained access.
   */
  private reportManifest({
    userId,
    organizationId,
    needsHumanDecision,
  }: {
    userId: string;
    organizationId: string;
    needsHumanDecision: ScimRemovalManifest;
  }): void {
    const { ownedApiKeys, personalTeams } = needsHumanDecision;
    if (ownedApiKeys.length === 0 && personalTeams.length === 0) return;
    logger.warn(
      {
        userId,
        organizationId,
        ownedApiKeyIds: ownedApiKeys.map((key) => key.id),
        personalTeamIds: personalTeams.map((team) => team.id),
      },
      "a directory deprovision removed a member's access and left owned resources that need an administrator's decision",
    );
  }
}

/** Exported for the tests that assert the stamp rather than re-derive it. */
export const SCIM_DEPROVISION_ACTOR_ID = SYSTEM_ACTORS.scim;
