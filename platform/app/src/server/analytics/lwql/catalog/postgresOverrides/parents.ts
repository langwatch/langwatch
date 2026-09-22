/**
 * The models that carry no tenant column of their own and reach one through a
 * declared parent.
 *
 * Each is a join table or a child row whose owning project is the parent's:
 * `GatewayBudgetLedger` belongs to its `GatewayBudget`, an `AnnotationQueueScores`
 * to its `AnnotationQueue`, and so on. Declaring the parent here is what lets
 * these models be *derived* rather than skipped — a true tenant path exists, so
 * the opt-out contract exposes them.
 *
 * @see ../derivePostgresCatalog.ts#resolveTenantScope — how a parent path resolves
 */

import type { PostgresDatasetOverride } from "../derivePostgresCatalog";

/** Tenant-less models, each reaching a tenant through a parent foreign key. */
export const PARENTS_POSTGRES_OVERRIDES: Record<
  string,
  PostgresDatasetOverride
> = {
  GatewayBudgetLedger: {
    tenantVia: { parent: "GatewayBudget", foreignKey: "budgetId" },
  },
  AnnotationQueueScores: {
    tenantVia: { parent: "AnnotationQueue", foreignKey: "annotationQueueId" },
  },
  ModelProviderScope: {
    tenantVia: { parent: "ModelProvider", foreignKey: "modelProviderId" },
  },
  ModelDefaultConfigScope: {
    tenantVia: { parent: "ModelDefaultConfig", foreignKey: "configId" },
  },
  VirtualKeyScope: {
    tenantVia: { parent: "VirtualKey", foreignKey: "virtualKeyId" },
  },
  RoutingPolicyScope: {
    tenantVia: { parent: "RoutingPolicy", foreignKey: "routingPolicyId" },
  },
  AiToolEntryDepartment: {
    tenantVia: { parent: "AiToolEntry", foreignKey: "entryId" },
  },
};
