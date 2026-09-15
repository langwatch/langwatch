/**
 * The procedures this package calls, and the hooks that call them.
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 *
 * The three procedures and their schemas come from the contract's own
 * declaration, so the browser cannot name a shape the door does not serve.
 */

import type { dataPrivacyTrpc } from "@langwatch/data-privacy-contract";
import { createModuleApi, type ContractApiMap, type ModuleApi } from "@langwatch/api/web";

export type DataPrivacyApiMap = ContractApiMap<typeof dataPrivacyTrpc>;

/**
 * The Data Privacy family's typed tRPC hooks. Same machinery, same transport
 * and same React Query cache as the application's `api` proxy — see
 * `createModuleApi` for why separate instances still share cache entries.
 */
export const dataPrivacyApi: ModuleApi<DataPrivacyApiMap> = createModuleApi<DataPrivacyApiMap>();
