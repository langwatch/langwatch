/**
 * A person's own two-step verification procedures, derived from identity's
 * contract: the setup is identity's, the screen is the personal workspace's.
 */
import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { twoStepVerificationTrpc } from "@langwatch/identity-contract";

export const twoStepVerificationApi =
  createModuleApi<ContractApiMap<typeof twoStepVerificationTrpc>>();
