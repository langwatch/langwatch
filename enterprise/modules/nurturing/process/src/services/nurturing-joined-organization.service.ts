// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createLogger } from "@langwatch/observability";

import type { NurturingClaimRepository } from "../repositories/nurturing-claim.repository.ts";
import { fireJoinedOrganization } from "../rules/nurturing-membership-join-service.rules.ts";
import { NurturingClaimReleaseService } from "./nurturing-claim-release.service.ts";
import type { NurturingService } from "./nurturing.service.ts";

const nurturingLogger = createLogger("langwatch:nurturing");

/** A person joins an organization once, so this outlives any realistic replay of the join. */
const JOINED_WINDOW_SECONDS = 365 * 24 * 60 * 60;

type JoinedOrganizationDependencies = Readonly<{
  claims: NurturingClaimRepository;
  customerIo: NurturingService;
}>;

/**
 * Lets the one joined_organization event, which starts a campaign, reach a person once per
 * organization however they joined and however often the join is replayed. Its slot, keyed on
 * person and organization, is held only once the track succeeded, so a replay of the same join,
 * the other route or a new join of theirs sends it after a failure.
 */
export class NurturingJoinedOrganizationService {
  static create(dependencies: JoinedOrganizationDependencies): NurturingJoinedOrganizationService {
    return new NurturingJoinedOrganizationService(dependencies);
  }

  private constructor(private readonly dependencies: JoinedOrganizationDependencies) {}

  /**
   * Tracks joined_organization for a join signal. Runs apart from the signal's delivered claim:
   * a replay that claim stops must still reach here. The slot is taken right before the track,
   * and any failure after it gives it back; a failed claim fails the delivery, which then retries.
   */
  async deliver(signal: NurturingSignal): Promise<void> {
    if (signal.kind !== "invite_accepted" && signal.kind !== "sso_auto_added") return;
    const [call] = fireJoinedOrganization(signal);
    if (!call) return;
    const { claims, customerIo } = this.dependencies;
    const claimKey = `nurturing:joined_organization:${signal.userId}:${signal.organizationId}`;
    if (!(await claims.claim(claimKey, JOINED_WINDOW_SECONDS))) return;
    try {
      await customerIo.trackEventOrThrow(call);
    } catch (error) {
      const released = await NurturingClaimReleaseService.create(claims).releasedAll([claimKey]);
      nurturingLogger.warn(
        { error, released },
        "joined_organization could not be delivered; its claim is given back",
      );
    }
  }
}
