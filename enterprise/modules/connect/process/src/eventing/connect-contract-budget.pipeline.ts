/**
 * Connect brings a customer's contract budget in line with its terms whenever licensing says
 * they moved (C3a). It appends no events; a repeat syncs to the same cap.
 * Spec: enterprise/modules/connect/specs/connect.feature
 */
import {
  CONTRACT_TERMS_CHANGED_EVENT_TYPE,
  contractTermsChangedEventDataSchema,
} from "@langwatch/enterprise-licensing-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { ConnectModule } from "../app/connect.app.ts";
import type { ContractBudgetService } from "../services/contract-budget.service.ts";

const CONNECT_CONTRACT_BUDGET_PIPELINE_NAME = "connect_contract_budget" as const;

export type ConnectContractBudgetPipeline = StaticPipelineDefinition<never>;

export function buildConnectContractBudgetPipeline({
  contractBudgets,
}: {
  contractBudgets: Pick<ContractBudgetService, "sync">;
}): ConnectContractBudgetPipeline {
  return definePipeline({
    name: CONNECT_CONTRACT_BUDGET_PIPELINE_NAME,
    // `global`: it appends no events of its own; it only reacts to licensing's terms fact.
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withPeerSubscriber("connectContractBudgetTermsChanged", {
      eventType: CONTRACT_TERMS_CHANGED_EVENT_TYPE,
      data: contractTermsChangedEventDataSchema,
      handle: (fact) =>
        contractBudgets.sync({ organizationId: fact.organizationId, operatorId: fact.operatorId }),
    })
    .build();
}

export const connectContractBudgetEventing = defineEventingModule({
  pipeline: CONNECT_CONTRACT_BUDGET_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, ConnectModule>) => app.contractBudgetPipeline(),
});
