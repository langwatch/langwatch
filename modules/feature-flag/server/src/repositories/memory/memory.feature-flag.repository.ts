import type { FeatureFlagRules, StoredFeatureFlag } from "@langwatch/feature-flag-contract";
import { Temporal, nowInstant, type Instant } from "@langwatch/time";
import type { FeatureFlagRow } from "../../app/feature-flag.app.ts";
import type { FeatureFlagRepository } from "../feature-flag.repository.ts";

type MemoryRecord = {
  enabled: boolean;
  rules: FeatureFlagRules;
  lastEditedBy: string | null;
  updatedAt: Instant;
};

/**
 * Operator rows held in process. Composition and resolver tests run the
 * real service graph against this instead of a database.
 */
export class MemoryFeatureFlagRepository implements FeatureFlagRepository {
  private readonly records = new Map<string, MemoryRecord>();

  private constructor(private readonly now: () => number) {}

  static create(
    now: () => number = () => nowInstant().epochMilliseconds,
  ): MemoryFeatureFlagRepository {
    return new MemoryFeatureFlagRepository(now);
  }

  async findByKey(key: string): Promise<FeatureFlagRow | null> {
    const record = this.records.get(key);
    if (!record) return null;

    return { enabled: record.enabled, rules: record.rules };
  }

  async findAll(): Promise<StoredFeatureFlag[]> {
    return [...this.records.entries()]
      .map(([key, record]) => ({ key, ...record }))
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  async upsertEnabled({
    key,
    enabled,
    lastEditedBy,
  }: {
    key: string;
    enabled: boolean;
    lastEditedBy: string | null;
  }): Promise<void> {
    const existing = this.records.get(key);
    this.records.set(key, {
      enabled,
      rules: existing?.rules ?? [],
      lastEditedBy,
      updatedAt: Temporal.Instant.fromEpochMilliseconds(this.now()),
    });
  }

  async upsertRules({
    key,
    rules,
    seedEnabled,
    lastEditedBy,
  }: {
    key: string;
    rules: FeatureFlagRules;
    seedEnabled: boolean;
    lastEditedBy: string | null;
  }): Promise<void> {
    const existing = this.records.get(key);
    this.records.set(key, {
      enabled: existing?.enabled ?? seedEnabled,
      rules,
      lastEditedBy,
      updatedAt: Temporal.Instant.fromEpochMilliseconds(this.now()),
    });
  }

  async deleteByKey(key: string): Promise<void> {
    this.records.delete(key);
  }
}
