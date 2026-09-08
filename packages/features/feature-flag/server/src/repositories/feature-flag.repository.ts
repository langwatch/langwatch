import type { FeatureFlagRules, StoredFeatureFlag } from "@langwatch/feature-flag-contract";
import type { FeatureFlagRow } from "../ports/feature-flag-cache.port.ts";

/**
 * The operator rows. The FeatureFlag table is cluster-wide and carries no
 * project column, so every query here is keyed by flag key alone.
 */
export interface FeatureFlagRepository {
  /** `null` when no operator row exists for the key. */
  findByKey(key: string): Promise<FeatureFlagRow | null>;

  /** Every row, registered or not, ordered by key. */
  findAll(): Promise<StoredFeatureFlag[]>;

  upsertEnabled(input: {
    key: string;
    enabled: boolean;
    lastEditedBy: string | null;
  }): Promise<void>;

  /**
   * `seedEnabled` is the row-level value written only when the row does not
   * exist yet. The caller derives it from the registry default so an
   * operator's first targeting rule cannot shadow that default for every
   * context the rule does not name.
   */
  upsertRules(input: {
    key: string;
    rules: FeatureFlagRules;
    seedEnabled: boolean;
    lastEditedBy: string | null;
  }): Promise<void>;

  deleteByKey(key: string): Promise<void>;
}
