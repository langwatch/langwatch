import type { GatewayApi } from "@langwatch/gateway-contract";
import { z } from "zod";

import type { ContractBudget, ContractBudgetStore } from "./contract-budget.service.ts";

/** Addresses the contract budget within its organization. */
export const CONTRACT_BUDGET_EXTERNAL_ID = "connect-contract";
const CAP_SET_BY = "connect_cap_set_by";
const CENTS = 100;

const contractBudgetMetadataSchema = z.object({ [CAP_SET_BY]: z.string().optional() });

type GatewayBudgets = Pick<
  GatewayApi,
  "listBudgetsWithHealth" | "createBudget" | "updateBudget" | "resetBudget"
>;

/**
 * The contract budget kept in the gateway's own budget table, reached through the gateway's
 * operations, as main's `PrismaContractBudgetStore` kept it.
 */
export class ContractBudgetStoreService implements ContractBudgetStore {
  static create({ gateway }: { gateway: GatewayBudgets }): ContractBudgetStoreService {
    return new ContractBudgetStoreService(gateway);
  }

  private constructor(private readonly gateway: GatewayBudgets) {}

  async findForOrganization(organizationId: string): Promise<ContractBudget | null> {
    const { budgets } = await this.gateway.listBudgetsWithHealth(organizationId);
    const budget = budgets.find(
      (candidate) =>
        candidate.externalId === CONTRACT_BUDGET_EXTERNAL_ID && candidate.archivedAt === null,
    );
    if (!budget) return null;
    const metadata = contractBudgetMetadataSchema.safeParse(budget.metadata ?? {});
    return {
      id: budget.id,
      limitUsdCents: Math.round(Number(budget.limitUsd.toString()) * CENTS),
      capSetByCustomer: metadata.success && metadata.data[CAP_SET_BY] === "customer",
    };
  }

  async create({
    organizationId,
    limitUsdCents,
    operatorId,
  }: {
    organizationId: string;
    limitUsdCents: number;
    operatorId: string;
  }): Promise<void> {
    await this.gateway.createBudget({
      organizationId,
      scope: { kind: "ORGANIZATION", organizationId },
      name: "Hosted services contract",
      description:
        "Hard stop for LangWatch-hosted services used by this customer's self-hosted installs.",
      // The period is the contract term, moved by renewal and not by a calendar.
      window: "MANUAL",
      limitUsd: (limitUsdCents / CENTS).toFixed(2),
      onBreach: "BLOCK",
      externalId: CONTRACT_BUDGET_EXTERNAL_ID,
      metadata: { [CAP_SET_BY]: "langwatch" },
      // The managed key that reaches it is created on the install's first call.
      allowUnreachable: true,
      actorUserId: operatorId,
    });
  }

  async setLimit({
    organizationId,
    id,
    limitUsdCents,
    capSetByCustomer,
    actorId,
  }: {
    organizationId: string;
    id: string;
    limitUsdCents: number;
    capSetByCustomer: boolean;
    actorId: string;
  }): Promise<void> {
    await this.gateway.updateBudget({
      id,
      organizationId,
      limitUsd: (limitUsdCents / CENTS).toFixed(2),
      metadata: { [CAP_SET_BY]: capSetByCustomer ? "customer" : "langwatch" },
      actorUserId: actorId,
    });
  }

  async reset({
    organizationId,
    id,
    actorId,
  }: {
    organizationId: string;
    id: string;
    actorId: string;
  }): Promise<void> {
    await this.gateway.resetBudget({ id, organizationId, actorUserId: actorId });
  }
}
