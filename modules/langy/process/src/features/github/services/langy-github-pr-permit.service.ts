import { LangyGithubPermit } from "../../turn/services/langy-turn-shared.service.ts";
import type { LangyGithubPrQuotaService } from "./langy-github-pr-quota.service.ts";

/** The turn's read of the daily pull request cap, on the feature package's own quota service. */
export class LangyGithubPrPermitService extends LangyGithubPermit {
  static create(quota: LangyGithubPrQuotaService): LangyGithubPrPermitService {
    return new LangyGithubPrPermitService(quota);
  }

  private constructor(private readonly quota: LangyGithubPrQuotaService) {
    super();
  }

  check(input: { userId: string }): Promise<{ allowed: boolean; resetAt: number }> {
    return this.quota.usage(input);
  }
}
