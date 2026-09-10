import { defineServerModule } from "@langwatch/runtime-composition";
import { EntitlementApp } from "./app/entitlement.app.ts";
import { entitlementRepositories } from "./repositories/entitlement-repositories.registry.ts";
import { organizationSpendTrpcTransport } from "./transport/organization-spend.trpc.ts";
import { planTrpcTransport } from "./transport/plan.trpc.ts";
import { usageLimitsTrpcTransport } from "./transport/usage-limits.trpc.ts";

export type { EntitlementInfrastructure } from "./app/entitlement.app.ts";

export const entitlementServer = defineServerModule("entitlement")
  .withRepositories(entitlementRepositories)
  .withApp(EntitlementApp)
  .withTransports(planTrpcTransport, usageLimitsTrpcTransport, organizationSpendTrpcTransport)
  .build();
