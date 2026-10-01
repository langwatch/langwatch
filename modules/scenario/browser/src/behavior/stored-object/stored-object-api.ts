/** The one procedure family this kit calls, derived from its owner's contract. */
import { type ContractApiMap, createModuleApi } from "@langwatch/api/web";
import type { storedObjectTrpc } from "@langwatch/stored-object-contract";

export const storedObjectApi = createModuleApi<ContractApiMap<typeof storedObjectTrpc>>();
