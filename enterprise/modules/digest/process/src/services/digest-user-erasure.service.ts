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
 * On user erasure, clears the person's subscription, sends and folded weeks everywhere, reading
 * no other module's table; a redelivery finds nothing and changes nothing. Spec: digest.feature.
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
