/** The one procedure family this kit calls, derived from its owner's contract. */
import { type ContractApiMap, createModuleApi, type ModuleApi } from "@langwatch/api/web";
import type { langyTrpc } from "@langwatch/langy-contract";

export const langyCodeAccessApi: ModuleApi<ContractApiMap<typeof langyTrpc>> =
  createModuleApi<ContractApiMap<typeof langyTrpc>>();
