import type {
  GatewayPrincipalDailySpend,
  GatewayPrincipalModelSpend,
  GatewayPrincipalSpendSummary,
  GatewayPrincipalSpendWindow,
} from "@langwatch/gateway-contract";

type PrincipalSpendInput = {
  tenantId: string;
  userId: string;
  window: GatewayPrincipalSpendWindow;
};

/** One user's principal-scope budget-ledger spend, collapsed to one row per gateway request. */
export abstract class GatewayPrincipalSpendRepository {
  abstract getSummary(input: PrincipalSpendInput): Promise<GatewayPrincipalSpendSummary>;
  abstract findDailySpend(input: PrincipalSpendInput): Promise<GatewayPrincipalDailySpend[]>;
  abstract findModelSpend(input: PrincipalSpendInput): Promise<GatewayPrincipalModelSpend[]>;
}
