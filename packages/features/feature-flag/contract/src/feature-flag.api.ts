import { featureApi } from "@langwatch/runtime-composition";
import type { FeatureFlagService } from "./feature-flag.service.ts";

/** Callable feature-flag operations shared by transports and process peers. */
export interface FeatureFlagApi extends FeatureFlagService {}

export const FeatureFlagApi = featureApi<FeatureFlagApi>("feature-flag");
