/** The procedures this package calls, derived from the contract; never hand-written. */

import { createModuleApi, type ContractApiMap, type ModuleApi } from "@langwatch/api/web";
import type { insightTrpc } from "@langwatch/insight-contract";

type InsightApiMap = ContractApiMap<typeof insightTrpc>;

export const insightApi: ModuleApi<InsightApiMap> = createModuleApi<InsightApiMap>();
