import type { FeatureFlagRules, StoredFeatureFlag } from "@langwatch/feature-flag-contract";
import type { FeatureFlagRow } from "../../ports/feature-flag-cache.port";
import { FeatureFlagRepository } from "../feature-flag.repository";

type MemoryRecord = {
  enabled: boolean;
  rules: FeatureFlagRules;
  lastEditedBy: string | null;
  updatedAt: Date;
};

/**
 * Operator rows held in process. Composition and resolver tests run the
 * real service graph against this instead of a database.
 */
export class MemoryFeatureFlagRepository extends FeatureFlagRepository {
  private readonly records = new Map<string, MemoryRecord>();
  private readonly organizations = new Map<string, Date>();
  /** How many times an age rule sent this repository to the organizations. */
  organizationReads = 0;
  /** Set to make the next organization read fail, the way a blip does. */
  private failNextOrganizationRead = false;

  private constructor(private readonly now: () => number) {
    super();
  }

  static create(now: () => number = Date.now): MemoryFeatureFlagRepository {
    return new MemoryFeatureFlagRepository(now);
  }

  async tryFindByKey(key: string): Promise<FeatureFlagRow | null> {
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
      updatedAt: new Date(this.now()),
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
      updatedAt: new Date(this.now()),
    });
  }

  async deleteByKey(key: string): Promise<void> {
    this.records.delete(key);
  }

  /** Seeds an organization a "new organizations" rule can be measured against. */
  rememberOrganization({
    organizationId,
    createdAt,
  }: {
    organizationId: string;
    createdAt: Date;
  }): void {
    this.organizations.set(organizationId, createdAt);
  }

  failNextOrganizationLookup(): void {
    this.failNextOrganizationRead = true;
  }

  async tryFindOrganizationCreatedAt(organizationId: string): Promise<Date | null> {
    this.organizationReads += 1;
    if (this.failNextOrganizationRead) {
      this.failNextOrganizationRead = false;
      throw new Error("connection reset");
    }

    return this.organizations.get(organizationId) ?? null;
  }
}
