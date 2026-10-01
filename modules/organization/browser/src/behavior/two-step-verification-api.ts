/**
 * The two-step verification procedures the members area calls, derived from
 * identity's contract: the requirement is identity's, the page is the organization's.
 */
import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { twoStepVerificationTrpc } from "@langwatch/identity-contract";

export const twoStepVerificationApi =
  createModuleApi<ContractApiMap<typeof twoStepVerificationTrpc>>();
