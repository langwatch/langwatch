/** Supplies existing process collaborators to the feature-owned entitlement installer. */
import type { EntitlementInfrastructure } from "@langwatch/entitlement-server";
import { entitlementServer } from "@langwatch/entitlement-server";
import { createApp } from "@langwatch/runtime-composition";
import { UserApi, type UserApi as UserApiContract } from "@langwatch/user-contract";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import {
  createOrganizationSpendTrpcRouter,
  createPlanTrpcRouter,
  createUsageLimitsTrpcRouter,
} from "./entitlement-trpc.mount.ts";
import type { ComposedEntitlementFeature } from "./entitlement.composition.types.ts";

/** The other feature's directory the plan resolution reads an operator from. */
export type EntitlementPeers = Readonly<{ users: UserApiContract }>;

/**
 * Installs what a plan allows and what has been used against it. The plan
 * sources, the month's counter and the approaching-limit mail are deployment
 * decisions this process makes and hands the feature.
 */
export async function installApiEntitlement(options: {
  infrastructure: ApiTrpcInfrastructure;
  entitlement: EntitlementInfrastructure;
  peers: EntitlementPeers;
}): Promise<ComposedEntitlementFeature> {
  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma: options.infrastructure.prisma })
    .withInfrastructure(options.entitlement)
    .withProvided(UserApi, options.peers.users)
    .withFeature(entitlementServer)
    .boot({ role: "api" });

  const app = runtime.feature(entitlementServer).provided;

  return {
    routers: (mount) => ({
      plan: createPlanTrpcRouter(mount.runtime, app),
      limits: createUsageLimitsTrpcRouter(mount.runtime, app),
      costs: createOrganizationSpendTrpcRouter(mount.runtime, app),
    }),
    app,
  };
}
