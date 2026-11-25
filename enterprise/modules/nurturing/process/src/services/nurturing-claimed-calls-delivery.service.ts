// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createHash } from "node:crypto";

import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";

import type { NurturingClaimRepository } from "../repositories/nurturing-claim.repository.ts";
import { type ClaimedSignal, fireClaimedSignal } from "../rules/nurturing-claimed-calls.rules.ts";
import { NurturingClaimReleaseService } from "./nurturing-claim-release.service.ts";
import type { NurturingService } from "./nurturing.service.ts";

type ClaimedCallsDeliveryDependencies = Readonly<{
  claims: NurturingClaimRepository;
  /** Rejects when Customer.io did not take the call, so the delivery fails and is retried. */
  customerIo: Pick<NurturingService, "batchOrThrow">;
  /** How long a sent call is remembered, the signal's own delivered window. */
  windowSeconds: number;
}>;

/** The recipient as a claim key carries them: a digest, so the claim store holds no person's id. */
function recipientDigestOf(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 16);
}

/**
 * Sends a claimed signal's calls in order, each claimed by type and recipient inside the
 * signal's claim: a retry after the first call went sends the rest alone, or all of them to a new
 * person. A refused call gives back its claim and the signal's, then fails the delivery so its
 * job retries.
 */
export class NurturingClaimedCallsDeliveryService {
  static create(
    dependencies: ClaimedCallsDeliveryDependencies,
  ): NurturingClaimedCallsDeliveryService {
    return new NurturingClaimedCallsDeliveryService(dependencies);
  }

  private constructor(private readonly dependencies: ClaimedCallsDeliveryDependencies) {}

  async deliver({
    signal,
    deliveredClaim,
  }: Readonly<{ signal: ClaimedSignal; deliveredClaim: string }>): Promise<void> {
    for (const call of fireClaimedSignal(signal)) {
      await this.sendOnce({ call, deliveredClaim });
    }
  }

  private async sendOnce({
    call,
    deliveredClaim,
  }: Readonly<{ call: CioBatchCall; deliveredClaim: string }>): Promise<void> {
    const { claims, customerIo, windowSeconds } = this.dependencies;
    const callClaim = `${deliveredClaim}:${call.type}:${recipientDigestOf(call.userId)}`;
    let claimed = false;
    try {
      claimed = await claims.claim(callClaim, windowSeconds);
      if (!claimed) return;
      await customerIo.batchOrThrow([call]);
    } catch (error) {
      await NurturingClaimReleaseService.create(claims).rethrowAfterReleasing({
        error,
        keys: claimed ? [callClaim, deliveredClaim] : [deliveredClaim],
      });
    }
  }
}
