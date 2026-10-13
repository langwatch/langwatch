// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The `ssoSetup.*` and `ssoConnections.*` hooks, derived from the contract's declarations rather than
 * hand-written, on the same transport and React Query cache as the
 * application's own `api` proxy.
 */
import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { ssoConnectionTrpc, ssoSetupTrpc } from "@langwatch/enterprise-sso-contract";

/** The back office's procedures too: the replacement import sso lends ops runs one of them. */
export type SsoApiMap = ContractApiMap<typeof ssoSetupTrpc> &
  ContractApiMap<typeof ssoConnectionTrpc>;

export const ssoApi = createModuleApi<SsoApiMap>();
