/** The staff access procedures, derived from the contract; same transport and cache as the app. */

import { createModuleApi, type ContractApiMap, type ModuleApi } from "@langwatch/api/web";
import type { staffAccessTrpc } from "@langwatch/staff-access-contract";

type StaffAccessApiMap = ContractApiMap<typeof staffAccessTrpc>;

export const staffAccessApi: ModuleApi<StaffAccessApiMap> = createModuleApi<StaffAccessApiMap>();
