import { LangyGithubPermit } from "../../turn/services/langy-turn-shared.service.ts";
import type { LangyGithubPrQuotaService } from "./langy-github-pr-quota.service.ts";

/** The turn's three permit calls, on the feature package's own quota service. */
export class LangyGithubPrPermitService extends LangyGithubPermit {
  static create(quota: LangyGithubPrQuotaService): LangyGithubPrPermitService {
    return new LangyGithubPrPermitService(quota);
  }

  private constructor(private readonly quota: LangyGithubPrQuotaService) {
    super();
  }

  reserve(input: { userId: string }): Promise<{
    reserved: boolean;
    allowed: boolean;
    resetAt: number;
  }> {
    return this.quota.reservePermit(input);
  }

  release(input: { userId: string }): Promise<void> {
    return this.quota.releasePermit(input);
  }

  check(input: { userId: string }): Promise<{ allowed: boolean }> {
    return this.quota.usage(input);
  }
}
