/**
 * Identity's join admissions, derived from identity's contract: who a domain admitted is
 * identity's, the members list that explains it is the organization's (round 24 EF-3).
 */
import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { identityTrpc } from "@langwatch/identity-contract";

export const joinAdmissionsApi = createModuleApi<ContractApiMap<typeof identityTrpc>>();
