/**
 * The procedures this package calls, and the hooks that call them. THE ONE
 * GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE (ADR-004) — schemas come
 * straight from the contract, so the browser cannot name an unserved shape.
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
