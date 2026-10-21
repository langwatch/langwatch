import { type Authorization, withoutSpanBraids } from "@langwatch/authorization";
import { type EntitlementApi, isEnterpriseTier } from "@langwatch/entitlement-contract";
import { nowInstant } from "@langwatch/time";

import { readsBraidedSpans } from "../../../rules/braided-span-owner.rules.ts";
import { TraceTtlCacheService } from "../../../services/trace-ttl-cache.service.ts";

type BraidPlans = Pick<EntitlementApi, "getActivePlan">;

/**
 * Braids pause below Enterprise and are kept (ADR-183 §9): the trace module, which owns the
 * merged read, asks the plan before honouring them. The answer is cached per organisation for no
 * longer than the proof that asked lives; a process composed without plans honours none.
 */
export class TraceBraidPauseService {
  static create(deps: { plans: BraidPlans | null }): TraceBraidPauseService {
    return new TraceBraidPauseService(deps.plans);
  }

  readonly #enterprise = TraceTtlCacheService.create<boolean>(0);

  private constructor(private readonly plans: BraidPlans | null) {}

  /** The proof as the read may honour it: without its braids while the plan is below Enterprise. */
  async honoured({ authorization }: { authorization: Authorization }): Promise<Authorization> {
    if (!readsBraidedSpans(authorization)) return authorization;
    const enterprise = await this.isEnterprise(authorization);
    return enterprise ? authorization : withoutSpanBraids(authorization);
  }

  private async isEnterprise(authorization: Authorization): Promise<boolean> {
    if (this.plans === null) return false;
    const { organizationId } = authorization.scope;
    const cached = await this.#enterprise.get(organizationId);
    if (cached.kind === "hit") return cached.value;
    const plan = await this.plans.getActivePlan({ organizationId });
    const enterprise = isEnterpriseTier(plan.type);
    const lifeMs = authorization.expiresAt - nowInstant().epochMilliseconds;
    if (lifeMs > 0) await this.#enterprise.set(organizationId, enterprise, lifeMs);
    return enterprise;
  }
}
