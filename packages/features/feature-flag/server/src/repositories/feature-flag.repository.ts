import type { FeatureFlagRules, StoredFeatureFlag } from "@langwatch/feature-flag-contract";
import type { FeatureFlagRow } from "../ports/feature-flag-cache.port";

export abstract class FeatureFlagRepository {
  /** `null` when no operator row exists for the key. */
  abstract tryFindByKey(key: string): Promise<FeatureFlagRow | null>;

  /** Every row, registered or not, ordered by key. */
  abstract findAll(): Promise<StoredFeatureFlag[]>;

  abstract upsertEnabled(input: {
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
  abstract upsertRules(input: {
    key: string;
    rules: FeatureFlagRules;
    seedEnabled: boolean;
    lastEditedBy: string | null;
  }): Promise<void>;

  abstract deleteByKey(key: string): Promise<void>;

  /**
   * When an organization was created, for a rule that targets new signups by
   * date. `null` when the organization is unknown, when the read failed, or
   * when this repository has no organization table to ask — all three fail
   * closed, because an age rule that cannot compare must not match.
   */
  abstract tryFindOrganizationCreatedAt(organizationId: string): Promise<Date | null>;
}
