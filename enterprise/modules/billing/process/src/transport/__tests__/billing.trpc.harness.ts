import type { OpsOperator } from "@langwatch/ops-contract";

/** What a mount reads off the request: the caller, their address, its headers, the operator. */
export type BillingTrpcTestContext = {
  actor: { id: string } | null;
  email?: string | null;
  headers?: Record<string, string | string[] | undefined> | null;
  operator?: OpsOperator | null;
};
