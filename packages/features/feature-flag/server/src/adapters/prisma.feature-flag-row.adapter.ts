import {
  parseRules,
  type FeatureFlagRules,
  type StoredFeatureFlag,
} from "@langwatch/feature-flag-contract";
import type { FeatureFlagRow } from "../ports/feature-flag-cache.port";
import { FeatureFlagRepository } from "../repositories/feature-flag.repository";

type DelegateCall<TResult> = {
  bivariant(input: object): Promise<TResult>;
}["bivariant"];

type FeatureFlagRecord = {
  key: string;
  enabled: boolean;
  rules: unknown;
  lastEditedBy: string | null;
  updatedAt: Date;
};

type FeatureFlagDelegate = {
  findUnique: DelegateCall<Pick<FeatureFlagRecord, "enabled" | "rules"> | null>;
  findMany: DelegateCall<FeatureFlagRecord[]>;
  upsert: DelegateCall<unknown>;
  deleteMany: DelegateCall<unknown>;
};

export type FeatureFlagDatabase = { featureFlag: FeatureFlagDelegate };

/**
 * The FeatureFlag table is cluster-wide and carries no project column, so
 * it is exempt from the tenancy middleware by design. Every query here is
 * keyed by flag key alone.
 */
export class PrismaFeatureFlagRowAdapter extends FeatureFlagRepository {
  private constructor(private readonly database: FeatureFlagDatabase) {
    super();
  }

  static create(database: FeatureFlagDatabase): PrismaFeatureFlagRowAdapter {
    return new PrismaFeatureFlagRowAdapter(database);
  }

  async tryFindByKey(key: string): Promise<FeatureFlagRow | null> {
    const row = await this.database.featureFlag.findUnique({
      where: { key },
      select: { enabled: true, rules: true },
    });
    if (!row) return null;

    return { enabled: row.enabled, rules: parseRules(row.rules) };
  }

  async findAll(): Promise<StoredFeatureFlag[]> {
    const rows = await this.database.featureFlag.findMany({
      select: {
        key: true,
        enabled: true,
        rules: true,
        lastEditedBy: true,
        updatedAt: true,
      },
      orderBy: { key: "asc" },
    });

    return rows.map((row) => ({
      key: row.key,
      enabled: row.enabled,
      rules: parseRules(row.rules),
      lastEditedBy: row.lastEditedBy,
      updatedAt: row.updatedAt,
    }));
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
    await this.database.featureFlag.upsert({
      where: { key },
      create: { key, enabled, lastEditedBy },
      update: { enabled, lastEditedBy },
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
    await this.database.featureFlag.upsert({
      where: { key },
      create: { key, enabled: seedEnabled, rules, lastEditedBy },
      update: { rules, lastEditedBy },
    });
  }

  async deleteByKey(key: string): Promise<void> {
    await this.database.featureFlag.deleteMany({ where: { key } });
  }
}
