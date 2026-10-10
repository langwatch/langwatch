/** The `connect.*` procedures the Connect page calls, derived from the contract. */

import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { connectTrpc } from "@langwatch/enterprise-licensing-contract";

export type ConnectApiMap = ContractApiMap<typeof connectTrpc>;

export const connectApi = createModuleApi<ConnectApiMap>();
