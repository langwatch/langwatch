// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createLogger } from "@langwatch/observability";

import type { NurturingClaimRepository } from "../repositories/nurturing-claim.repository.ts";
import {
  fireOwnCodingFirstSession,
  fireOwnCodingLastSession,
} from "../rules/nurturing-coding-delivery.rules.ts";
import { ownCodingFirstSessionClaim } from "../rules/nurturing-delivery-debounce.rules.ts";
import { NurturingClaimReleaseService } from "./nurturing-claim-release.service.ts";
import type { NurturingService } from "./nurturing.service.ts";

const nurturingLogger = createLogger("langwatch:nurturing");

type OwnCodingDependencies = Readonly<{
  claims: NurturingClaimRepository;
  customerIo: NurturingService;
}>;

/**
 * Delivery's collaborator for a person's own coding traits: the latest session on each signal
 * past the debounce, and own_coding_first_session_at, first recorded across orgs, set once. A
 * first whose send fails gives its claim back, so the person's next session sets it.
 */
export class NurturingOwnCodingDeliveryService {
  static create(dependencies: OwnCodingDependencies): NurturingOwnCodingDeliveryService {
    return new NurturingOwnCodingDeliveryService(dependencies);
  }

  private constructor(private readonly dependencies: OwnCodingDependencies) {}

  async deliver(signal: NurturingSignal): Promise<void> {
    if (signal.kind !== "own_coding_session_stored") return;
    const { claims, customerIo } = this.dependencies;
    void customerIo.batch(fireOwnCodingLastSession(signal)).catch((error: unknown) => {
      nurturingLogger.warn({ error }, "own_coding_last_session_at could not be delivered");
    });
    const { claimKey, seconds } = ownCodingFirstSessionClaim(signal);
    if (!(await claims.claim(claimKey, seconds))) return;
    try {
      await customerIo.batch(fireOwnCodingFirstSession(signal));
    } catch (error) {
      const released = await NurturingClaimReleaseService.create(claims).releasedAll([claimKey]);
      nurturingLogger.warn(
        { error, released },
        "own_coding_first_session_at could not be delivered; its claim is given back",
      );
    }
  }
}
