/**
 * The two sign-in security procedures this page calls, derived from auth's
 * contract: the rules are auth's, the page sits in the organization's settings.
 */
import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { signInSecurityTrpc } from "@langwatch/auth-contract";

export const signInSecurityApi = createModuleApi<ContractApiMap<typeof signInSecurityTrpc>>();
