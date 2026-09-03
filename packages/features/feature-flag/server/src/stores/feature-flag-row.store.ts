import type { FeatureFlagRow } from "../ports/feature-flag-cache.port";

export abstract class FeatureFlagRowStore {
  abstract tryGetRow(key: string): Promise<FeatureFlagRow | null>;
  abstract invalidate(key: string): Promise<void>;
}
