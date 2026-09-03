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

type OrganizationDelegate = {
  findUnique: DelegateCall<{ createdAt: Date } | null>;
};

export type FeatureFlagDatabase = {
  featureFlag: FeatureFlagDelegate;
  /**
   * Read only by a "new organizations" targeting rule, and optional so a
   * caller that hands over the flag table alone still composes. A process
   * that passes the whole client gets the lookup; one that does not answers
   * "unknown", which matches no age rule.
   */
  organization?: OrganizationDelegate;
};

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

  async tryFindOrganizationCreatedAt(organizationId: string): Promise<Date | null> {
    const organization = await this.database.organization?.findUnique({
      where: { id: organizationId },
      select: { createdAt: true },
    });

    return organization?.createdAt ?? null;
  }
}
