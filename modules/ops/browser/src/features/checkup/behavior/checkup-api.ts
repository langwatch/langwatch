/** The `checkup.*` procedures Settings, Checkup calls, derived from the contract. */

import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { checkupTrpc } from "@langwatch/ops-contract";

export type CheckupApiMap = ContractApiMap<typeof checkupTrpc>;

export const checkupApi = createModuleApi<CheckupApiMap>();
