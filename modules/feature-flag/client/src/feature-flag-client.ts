/** The hooks feature flags' own contract generates. */

import { type ContractApiMap, createModuleApi, type ModuleApi } from "@langwatch/api/web";
import type { featureFlagTrpc } from "@langwatch/feature-flag-contract";

type FeatureFlagApiMap = ContractApiMap<typeof featureFlagTrpc>;

export const featureFlagClient: ModuleApi<FeatureFlagApiMap> = createModuleApi<FeatureFlagApiMap>();

// The service caches operator rows for five seconds. Refetching every mounted
// read at that cadence adds traffic without making a decision fresher, so the
// browser keeps a resolved value for five minutes.
export const CLIENT_FLAG_STALE_TIME_MS = 5 * 60_000;
