/** The one procedure family this kit calls, derived from its owner's contract. */
import { type ContractApiMap, createModuleApi } from "@langwatch/api/web";
import type { userTrpc } from "@langwatch/user-contract";

export const userApi = createModuleApi<ContractApiMap<typeof userTrpc>>();
