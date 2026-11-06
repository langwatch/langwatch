// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  CioBatchCall,
  NurturingSignal,
  NurturingSignalOf,
} from "@langwatch/enterprise-nurturing-contract";
import { createLogger } from "@langwatch/observability";

import type { NurturingClaimRepository } from "../repositories/nurturing-claim.repository.ts";
import { NurturingClaimReleaseService } from "./nurturing-claim-release.service.ts";

const nurturingLogger = createLogger("langwatch:nurturing");

/** A failure here is swallowed: the join the customer asked for is already done. */
function reportFailure(error: unknown): void {
  nurturingLogger.warn({ error }, "a lifecycle signal could not be delivered");
}

/** A person joins an organization once, so this outlives any realistic replay of the join. */
const JOINED_WINDOW_SECONDS = 365 * 24 * 60 * 60;

type JoinSignal = Pick<NurturingSignalOf<"invite_accepted">, "userId" | "organizationId">;
type TrackCall = Extract<CioBatchCall, { type: "track" }>;

/**
 * Lets the one joined_organization event, which starts a campaign, reach a person once per
 * organization however they joined and however often the join is replayed.
 */
export class NurturingJoinedOrganizationService {
  static create({
    claims,
  }: {
    claims: NurturingClaimRepository;
  }): NurturingJoinedOrganizationService {
    return new NurturingJoinedOrganizationService(claims);
  }

  private constructor(private readonly claims: NurturingClaimRepository) {}

  /**
   * True when this is the person's first join of this organization, by invite or by SSO.
   * Keyed on person and organization, not on the source event, so a replay or the other route
   * is not first. Always true for a signal that is no join. When the claim fails, the signal's
   * own delivered claim is given back and the error rethrown.
   */
  async isFirstJoin({
    signal,
    deliveredClaim,
  }: {
    signal: NurturingSignal;
    deliveredClaim: string;
  }): Promise<boolean> {
    if (signal.kind !== "invite_accepted" && signal.kind !== "sso_auto_added") return true;
    try {
      return await this.claims.claim(claimKey(signal), JOINED_WINDOW_SECONDS);
    } catch (error) {
      reportFailure(error);
      return NurturingClaimReleaseService.create(this.claims).rethrowAfterReleasing({
        error,
        keys: [deliveredClaim],
      });
    }
  }

  /**
   * Reports a failed track. A joined_organization that failed to send gives its
   * person-and-organization slot back, so the next join signal of theirs can send it; the slot
   * stays held after a success.
   */
  afterFailedTrack(call: TrackCall, error: unknown): void {
    reportFailure(error);
    if (call.event !== "joined_organization") return;
    const { organization_id: organizationId } = call.properties ?? {};
    if (typeof organizationId !== "string") return;
    void NurturingClaimReleaseService.create(this.claims)
      .releasedAll([claimKey({ userId: call.userId, organizationId })])
      .then((released) => {
        if (released.length > 0) reportFailure(new AggregateError(released));
      });
  }
}

function claimKey(signal: JoinSignal): string {
  return `nurturing:joined_organization:${signal.userId}:${signal.organizationId}`;
}
