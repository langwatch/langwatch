// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The `ssoSetup.*` hooks, derived from the contract's declarations rather than
 * hand-written, on the same transport and React Query cache as the
 * application's own `api` proxy.
 */
import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { ssoSetupTrpc } from "@langwatch/enterprise-sso-contract";

export type SsoApiMap = ContractApiMap<typeof ssoSetupTrpc>;

export const ssoApi = createModuleApi<SsoApiMap>();
