import { type Authorization, honourSpanBraids, withoutSpanBraids } from "@langwatch/authorization";
import { type EntitlementApi, isEnterpriseTier } from "@langwatch/entitlement-contract";
import { nowInstant } from "@langwatch/time";

import { TraceTtlCacheService } from "../../../services/trace-ttl-cache.service.ts";
import { readsBraidedSpans } from "../../braid/rules/braided-span-owner.rules.ts";

type BraidPlans = Pick<EntitlementApi, "getActivePlan">;

/**
 * Braids pause below Enterprise and are kept (ADR-201 §9): the trace module, which owns the
 * merged read, asks the plan, and only it may honour them; a proof it never saw reads none. Cached
 * per organisation for no longer than the proof that asked lives.
 */
export class TraceBraidPauseService {
  static create(deps: { plans: BraidPlans }): TraceBraidPauseService {
    return new TraceBraidPauseService(deps.plans);
  }

  readonly #enterprise = TraceTtlCacheService.create<boolean>(0);

  private constructor(private readonly plans: BraidPlans) {}

  /** The proof as the read may honour it: braids honoured on Enterprise, stripped below it. */
  async honoured({ authorization }: { authorization: Authorization }): Promise<Authorization> {
    if (!readsBraidedSpans(authorization)) return authorization;
    const enterprise = await this.isEnterprise(authorization);
    return enterprise ? honourSpanBraids({ authorization }) : withoutSpanBraids(authorization);
  }

  private async isEnterprise(authorization: Authorization): Promise<boolean> {
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
