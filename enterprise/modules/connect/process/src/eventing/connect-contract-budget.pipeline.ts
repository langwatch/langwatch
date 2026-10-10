/**
 * Connect brings a customer's contract budget in line with its terms whenever licensing says they
 * moved, and starts a new window when billing renews the customer (C3a). No events of its own.
 * Spec: enterprise/modules/connect/specs/connect.feature
 */
import {
  CONNECTED_CUSTOMER_ONBOARDED_EVENT_TYPE,
  CONNECTED_TERM_RENEWED_EVENT_TYPE,
  connectedCustomerOnboardedEventDataSchema,
  connectedTermRenewedEventDataSchema,
} from "@langwatch/enterprise-billing-contract";
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
  contractBudgets: Pick<ContractBudgetService, "sync" | "reset">;
}): ConnectContractBudgetPipeline {
  return definePipeline({
    name: CONNECT_CONTRACT_BUDGET_PIPELINE_NAME,
    // `global`: it appends no events of its own; it only reacts to licensing's and billing's facts.
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withPeerSubscriber("connectContractBudgetTermsChanged", {
      eventType: CONTRACT_TERMS_CHANGED_EVENT_TYPE,
      data: contractTermsChangedEventDataSchema,
      handle: (fact) =>
        contractBudgets.sync({ organizationId: fact.organizationId, operatorId: fact.operatorId }),
    })
    .withPeerSubscriber("connectContractBudgetCustomerOnboarded", {
      eventType: CONNECTED_CUSTOMER_ONBOARDED_EVENT_TYPE,
      data: connectedCustomerOnboardedEventDataSchema,
      handle: (fact) =>
        contractBudgets.sync({ organizationId: fact.organizationId, operatorId: fact.operatorId }),
    })
    .withPeerSubscriber("connectContractBudgetTermRenewed", {
      eventType: CONNECTED_TERM_RENEWED_EVENT_TYPE,
      data: connectedTermRenewedEventDataSchema,
      handle: async (fact) => {
        const input = { organizationId: fact.organizationId, operatorId: fact.operatorId };
        await contractBudgets.reset({ ...input, renewedAtMs: fact.occurredAt });
        await contractBudgets.sync(input);
      },
    })
    .build();
}

export const connectContractBudgetEventing = defineEventingModule({
  pipeline: CONNECT_CONTRACT_BUDGET_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, ConnectModule>) => app.contractBudgetPipeline(),
});
