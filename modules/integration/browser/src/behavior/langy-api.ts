/** Langy's code-access procedures, derived from its contract; the kit's block fetches nothing. */
import { type ContractApiMap, createModuleApi, type ModuleApi } from "@langwatch/api/web";
import type { langyTrpc } from "@langwatch/langy-contract";

export const langyApi: ModuleApi<ContractApiMap<typeof langyTrpc>> =
  createModuleApi<ContractApiMap<typeof langyTrpc>>();
