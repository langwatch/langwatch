import { type Authorization, honourSpanBraids, withoutSpanBraids } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import { type EntitlementApi, isEnterpriseTier } from "@langwatch/entitlement-contract";
import type { Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import { TraceTtlCacheService } from "../../../services/trace-ttl-cache.service.ts";
import { readsBraidedSpans } from "../../braid/rules/braided-span-owner.rules.ts";

type BraidPlans = Pick<EntitlementApi, "getActivePlan">;
type BraidSettings = Pick<AuthzApi, "getOrganizationPolicy">;
type TraceBraidPauseDeps = {
  plans: BraidPlans;
  settings: BraidSettings;
  logger: Pick<Logger, "error">;
};

/**
 * Braids pause below Enterprise and while the organisation has Braids turned off (ADR-201 §9).
 * Cached per organisation no longer than the asking proof, so a change shows within its bound;
 * a failed setting read drops the braids for that read alone and keeps the own-project grant.
 */
export class TraceBraidPauseService {
  static create(deps: TraceBraidPauseDeps): TraceBraidPauseService {
    return new TraceBraidPauseService(deps);
  }

  readonly #honours = TraceTtlCacheService.create<boolean>(0);

  private constructor(private readonly deps: TraceBraidPauseDeps) {}

  /** The proof as the read may honour it: braids honoured when on, stripped while paused. */
  async honoured({ authorization }: { authorization: Authorization }): Promise<Authorization> {
    if (!readsBraidedSpans(authorization)) return authorization;
    const honours = await this.honoursBraids(authorization);
    return honours ? honourSpanBraids({ authorization }) : withoutSpanBraids(authorization);
  }

  private async honoursBraids(authorization: Authorization): Promise<boolean> {
    const { organizationId } = authorization.scope;
    const cached = await this.#honours.get(organizationId);
    if (cached.kind === "hit") return cached.value;
    const { honours, known } = await this.askHonours({ organizationId });
    const lifeMs = authorization.expiresAt - nowInstant().epochMilliseconds;
    if (known && lifeMs > 0) await this.#honours.set(organizationId, honours, lifeMs);
    return honours;
  }

  /** The plan first: below Enterprise the setting is never asked. An unread setting is not kept. */
  private async askHonours({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ honours: boolean; known: boolean }> {
    const plan = await this.deps.plans.getActivePlan({ organizationId });
    if (!isEnterpriseTier(plan.type)) return { honours: false, known: true };
    try {
      const policy = await this.deps.settings.getOrganizationPolicy({ organizationId });
      return { honours: policy.braidsEnabled, known: true };
    } catch (error) {
      this.deps.logger.error(
        { error, organizationId },
        "braids setting read failed; braids dropped",
      );
      return { honours: false, known: false };
    }
  }
}
