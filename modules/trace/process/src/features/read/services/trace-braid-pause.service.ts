import { type Authorization, honourSpanBraids, withoutSpanBraids } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import { type EntitlementApi, isEnterpriseTier } from "@langwatch/entitlement-contract";
import { nowInstant } from "@langwatch/time";

import { TraceTtlCacheService } from "../../../services/trace-ttl-cache.service.ts";
import { readsBraidedSpans } from "../../braid/rules/braided-span-owner.rules.ts";

type BraidPlans = Pick<EntitlementApi, "getActivePlan">;
type BraidSettings = Pick<AuthzApi, "getOrganizationPolicy">;

/**
 * Braids pause below Enterprise and while the organisation has Braids turned off, and are kept
 * (ADR-201 §9): only this read honours them. Cached per organisation for no longer than the
 * asking proof lives, so a change shows within the proof bound.
 */
export class TraceBraidPauseService {
  static create(deps: { plans: BraidPlans; settings: BraidSettings }): TraceBraidPauseService {
    return new TraceBraidPauseService(deps.plans, deps.settings);
  }

  readonly #honours = TraceTtlCacheService.create<boolean>(0);

  private constructor(
    private readonly plans: BraidPlans,
    private readonly settings: BraidSettings,
  ) {}

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
    const honours = await this.askHonours({ organizationId });
    const lifeMs = authorization.expiresAt - nowInstant().epochMilliseconds;
    if (lifeMs > 0) await this.#honours.set(organizationId, honours, lifeMs);
    return honours;
  }

  /** The plan first: below Enterprise the setting is never asked. */
  private async askHonours({ organizationId }: { organizationId: string }): Promise<boolean> {
    const plan = await this.plans.getActivePlan({ organizationId });
    if (!isEnterpriseTier(plan.type)) return false;
    const policy = await this.settings.getOrganizationPolicy({ organizationId });
    return policy.braidsEnabled;
  }
}
