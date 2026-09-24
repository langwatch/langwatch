/** The models that carry no tenant column of their own and reach one through a declared parent. */

import type { PostgresDatasetOverride } from "./lwql-postgres-catalog-model.rules.ts";

/** Tenant-less models, each reaching a tenant through a parent foreign key. */
export const PARENTS_POSTGRES_OVERRIDES: Record<string, PostgresDatasetOverride> = {
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
