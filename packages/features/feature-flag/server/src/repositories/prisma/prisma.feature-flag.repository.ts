import {
  parseRules,
  type FeatureFlagRules,
  type StoredFeatureFlag,
} from "@langwatch/feature-flag-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { fromDate } from "@langwatch/time";
import type { FeatureFlagRow } from "../../ports/feature-flag-cache.port.ts";
import type { FeatureFlagRepository } from "../feature-flag.repository.ts";

const featureFlagRowSelect = { enabled: true, rules: true } as const;

const storedFeatureFlagSelect = {
  key: true,
  enabled: true,
  rules: true,
  lastEditedBy: true,
  updatedAt: true,
} as const;

/**
 * The FeatureFlag table is cluster-wide and carries no project column, so it
 * is exempt from the tenancy middleware by design. Every query here is keyed
 * by flag key alone.
 */
export class PrismaFeatureFlagRepository
  extends PrismaRepository.for("FeatureFlag")
  implements FeatureFlagRepository
{
  static readonly create = this.factory((prisma) => new PrismaFeatureFlagRepository(prisma));

  async findByKey(key: string): Promise<FeatureFlagRow | null> {
    const row = await this.prisma.featureFlag.findUnique({
      where: { key },
      select: featureFlagRowSelect,
    });
    if (!row) return null;

    return { enabled: row.enabled, rules: parseRules(row.rules) };
  }

  async findAll(): Promise<StoredFeatureFlag[]> {
    const rows = await this.prisma.featureFlag.findMany({
      select: storedFeatureFlagSelect,
      orderBy: { key: "asc" },
    });

    return rows.map((row) => ({
      key: row.key,
      enabled: row.enabled,
      rules: parseRules(row.rules),
      lastEditedBy: row.lastEditedBy,
      updatedAt: fromDate(row.updatedAt),
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
    await this.prisma.featureFlag.upsert({
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
    const stored = rules as Prisma.InputJsonValue;
    await this.prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled: seedEnabled, rules: stored, lastEditedBy },
      update: { rules: stored, lastEditedBy },
    });
  }

  async deleteByKey(key: string): Promise<void> {
    await this.prisma.featureFlag.deleteMany({ where: { key } });
  }
}
