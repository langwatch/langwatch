/**
 * The procedures this package calls, derived from the contract. The segment
 * name is load-bearing (tRPC cache key). ADR-004: this is the one governed-closure
 * exception, importing from `@langwatch/api/web`.
 */

import type { licenseTrpc } from "@langwatch/enterprise-licensing-contract";
import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { TimeInput } from "@langwatch/time";
import type { PlanType } from "../model/plan-form-defaults.ts";

/** The plan template a minted key carries, as the generator form fills it in. */
export type LicenseMintInput = {
  organizationId: string;
  privateKey: string;
  organizationName: string;
  email: string;
  expiresAt: TimeInput;
  planType: PlanType;
  plan: Record<string, unknown>;
};

/** Everything this family calls: the derived namespace. */
export type LicensingApiMap = ContractApiMap<typeof licenseTrpc>;

/**
 * The licensing family's typed tRPC hooks. INTERNAL to this package: screens
 * call it, and the process shell mounts `licensingApi.Provider`.
 */
export const licensingApi = createModuleApi<LicensingApiMap>();
