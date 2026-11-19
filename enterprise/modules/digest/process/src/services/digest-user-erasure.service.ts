// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { DigestAudienceRepository } from "../repositories/digest-audience.repository.ts";
import type { DigestSendRepository } from "../repositories/digest-send.repository.ts";
import type { DigestUserWeekRepository } from "../repositories/digest-week.repository.ts";

type Deps = Readonly<{
  audience: Pick<DigestAudienceRepository, "forgetUser">;
  sends: Pick<DigestSendRepository, "forgetUser">;
  userWeeks: Pick<DigestUserWeekRepository, "forgetUser">;
}>;

/**
 * Clears digest rows on user erasure: the person's subscription, their sends and their folded
 * weeks, in every organization. It sends nothing and reads no other module's table; a
 * redelivery finds nothing left and changes nothing.
 * Spec: enterprise/modules/digest/specs/digest.feature
 */
export class DigestUserErasureService {
  static create(deps: Deps): DigestUserErasureService {
    return new DigestUserErasureService(deps);
  }

  private constructor(private readonly deps: Deps) {}

  async forgetUser({ userId }: { userId: string }): Promise<void> {
    await this.deps.audience.forgetUser({ userId });
    await this.deps.sends.forgetUser({ userId });
    await this.deps.userWeeks.forgetUser({ userId });
  }
}
