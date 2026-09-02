import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { GatewayInternalStorePort } from "../ports/gateway-internal-store.port";
import type { VirtualKeyWithScopes } from "../ports/gateway-virtual-key.port";
import { gatewayRoutingPolicySelect } from "./gateway-routing-policy-select.adapter";

const logger = createLogger("langwatch:gateway:internal-store");

/**
 * The internal control plane's row reads, over one Postgres connection.
 *
 * Every query below is transcribed from the route handler it was inline in,
 * including its `include` and `select` clauses, because those clauses are the
 * contract: the config read's `routingPolicy` selection is what carries the
 * model aliases and the deny rules, and a materialisation that lost it would
 * publish a bundle the gateway happily serves with no aliases and no policy.
 */
export class PrismaGatewayInternalStoreAdapter extends GatewayInternalStorePort {
  static create(options: { database: PrismaClient }): PrismaGatewayInternalStoreAdapter {
    return new PrismaGatewayInternalStoreAdapter(options.database);
  }

  private constructor(private readonly database: PrismaClient) {
    super();
  }

  async findVirtualKeyForConfig(virtualKeyId: string): Promise<VirtualKeyWithScopes | null> {
    const found = await this.database.virtualKey.findUnique({
      where: { id: virtualKeyId },
      include: {
        scopes: true,
        // Part of the virtual-key record the materialiser is typed against, and
        // read exactly as the gateway's own repository reads it.
        principalUser: { select: { id: true, name: true, email: true } },
        // The routing policy is where model_aliases and policy_rules live.
        // Without it the materialiser reads an absent relation and emits an
        // empty alias map plus empty deny/allow lists, so the gateway never
        // resolves an alias and never enforces a model deny rule.
        routingPolicy: { select: gatewayRoutingPolicySelect },
      },
    });
    return (found as VirtualKeyWithScopes | null) ?? null;
  }

  findBudget(budgetId: string) {
    return this.database.gatewayBudget.findUnique({ where: { id: budgetId } });
  }

  findBucketBoundary(input: { budgetId: string; bucketScopeId: string }) {
    return this.database.gatewayBudgetBucketBoundary.findUnique({
      where: {
        budgetId_bucketScopeId: {
          budgetId: input.budgetId,
          bucketScopeId: input.bucketScopeId,
        },
      },
      select: { periodStartedAt: true },
    });
  }

  async listProjectIdsForOrganization(organizationId: string): Promise<string[]> {
    const projects = await this.database.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    return projects.map((project) => project.id);
  }

  findVirtualKeysForAttribution(virtualKeyIds: readonly string[]) {
    return this.database.virtualKey.findMany({
      where: { id: { in: [...virtualKeyIds] } },
      select: {
        id: true,
        organizationId: true,
        principalUserId: true,
        lastUsedAt: true,
      },
    });
  }

  findProjectTeams(projectIds: readonly string[]) {
    return this.database.project.findMany({
      where: { id: { in: [...projectIds] } },
      select: { id: true, teamId: true },
    });
  }

  /**
   * Best effort, and the swallow is deliberate: this write is administrative
   * oversight, and the caller is in the middle of appending billing records
   * that must not be retried because a timestamp column would not move.
   */
  async touchVirtualKeysLastUsed(input: {
    virtualKeyIds: readonly string[];
    now: Date;
  }): Promise<void> {
    if (input.virtualKeyIds.length === 0) return;
    try {
      await this.database.virtualKey.updateMany({
        where: { id: { in: [...input.virtualKeyIds] } },
        data: { lastUsedAt: input.now },
      });
    } catch (error) {
      logger.warn(
        { virtualKeyIds: input.virtualKeyIds, error },
        "failed to advance virtualKey.lastUsedAt for admitted spend commands",
      );
    }
  }
}
