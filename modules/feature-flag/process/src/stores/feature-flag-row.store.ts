import type { FeatureFlagRow } from "../app/feature-flag.app.ts";

/**
 * One operator row as the resolver reads it, with the caching tiers behind
 * it. `null` is an absent row, which resolves to the registry default.
 */
export abstract class FeatureFlagRowStore {
  abstract findRow(key: string): Promise<FeatureFlagRow | null>;

  /** Drops every tier's copy, so the next read sees an operator write. */
  abstract invalidate(key: string): Promise<void>;
}
