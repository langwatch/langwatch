// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";

import type { NurturingClaimRepository } from "../repositories/nurturing-claim.repository.ts";
import {
  fireGatewayKeySignal,
  type GatewayKeySignal,
} from "../rules/nurturing-gateway-facts.rules.ts";
import { NurturingClaimReleaseService } from "./nurturing-claim-release.service.ts";
import type { NurturingService } from "./nurturing.service.ts";

type GatewayKeyDeliveryDependencies = Readonly<{
  claims: NurturingClaimRepository;
  /** Rejects when Customer.io did not take the call, so the delivery fails and is retried. */
  customerIo: Pick<NurturingService, "batchOrThrow">;
  /** How long a sent call is remembered, the signal's own delivered window. */
  windowSeconds: number;
}>;

/**
 * Sends a gateway key signal's calls one after the other, each under its own claim inside the
 * signal's: a retry after the identify went and the track failed sends the track alone. A
 * refused call gives back its claim and the signal's, then fails the delivery so its job retries.
 */
export class NurturingGatewayKeyDeliveryService {
  static create(dependencies: GatewayKeyDeliveryDependencies): NurturingGatewayKeyDeliveryService {
    return new NurturingGatewayKeyDeliveryService(dependencies);
  }

  private constructor(private readonly dependencies: GatewayKeyDeliveryDependencies) {}

  async deliver({
    signal,
    deliveredClaim,
  }: Readonly<{ signal: GatewayKeySignal; deliveredClaim: string }>): Promise<void> {
    for (const call of fireGatewayKeySignal(signal)) {
      await this.sendOnce({ call, deliveredClaim });
    }
  }

  private async sendOnce({
    call,
    deliveredClaim,
  }: Readonly<{ call: CioBatchCall; deliveredClaim: string }>): Promise<void> {
    const { claims, customerIo, windowSeconds } = this.dependencies;
    const callClaim = `${deliveredClaim}:${call.type}`;
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
