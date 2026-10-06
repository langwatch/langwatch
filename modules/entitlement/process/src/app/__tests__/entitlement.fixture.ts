import type {
  EntitlementConfig,
  EntitlementSource,
  Plan,
  SendUsageLimitWarningInput,
  UsageLimitWarning,
  UsageUnit,
} from "@langwatch/entitlement-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";

import type { EntitlementRepositories } from "../../repositories/entitlement.repositories.ts";
import { MemoryEntitlementRepositories } from "../../repositories/memory/memory.entitlement.repositories.ts";
import {
  USAGE_UNKNOWN,
  type UsageCount,
  type UsageCounter,
  type UsageLimitResult,
} from "../../services/usage-enforcement.service.ts";
import type { UsageWarning } from "../../services/usage-warning.service.ts";
import { EntitlementModule } from "../entitlement.app.ts";
import type { EntitlementInfrastructure } from "../entitlement.app.ts";

/** A source that always answers the same plan, or none at all. */
export function fixedEntitlementSource(plan: Plan | null): EntitlementSource {
  return { resolve: async () => (plan ? { granted: true, plan } : { granted: false }) };
}

/** A counter that answers one figure, or {@link USAGE_UNKNOWN}. */
export class TestUsageCounter implements UsageCounter {
  static create(
    count: UsageCount = USAGE_UNKNOWN,
    usageUnit: UsageUnit = "traces",
  ): TestUsageCounter {
    return new TestUsageCounter(count, usageUnit);
  }

  private constructor(
    private readonly count: UsageCount,
    private readonly usageUnit: UsageUnit,
    private readonly limit: UsageLimitResult = { exceeded: false },
  ) {}

  /** The same counter, answering `limit` to every enforcement read. */
  withLimit(limit: UsageLimitResult): TestUsageCounter {
    return new TestUsageCounter(this.count, this.usageUnit, limit);
  }

  async checkLimitForOrganization(): Promise<UsageLimitResult> {
    return this.limit;
  }

  async getCurrentMonthCountForDisplay(): Promise<UsageCount> {
    return this.count;
  }

  async getResolvedUsageUnit(): Promise<UsageUnit> {
    return this.usageUnit;
  }
}

/** A warning sender that records what it was asked and answers what it was told to. */
export class TestUsageWarnings implements UsageWarning {
  readonly sent: SendUsageLimitWarningInput[] = [];

  static create(answer: UsageLimitWarning = { sent: false }): TestUsageWarnings {
    return new TestUsageWarnings(answer);
  }

  private constructor(private readonly answer: UsageLimitWarning) {}

  async sendWarning(input: SendUsageLimitWarningInput): Promise<UsageLimitWarning> {
    this.sent.push(input);

    return this.answer;
  }

  async sweep(): Promise<void> {}
}

export function createEntitlementTestUsers(): UserApi {
  return createApiFixture<UserApi>({ findById: async () => null });
}

export function createEntitlementTestApp(
  input: Readonly<{
    repositories?: EntitlementRepositories;
    infrastructure: Omit<EntitlementInfrastructure, "counter" | "warnings"> &
      Partial<Pick<EntitlementInfrastructure, "counter" | "warnings">>;
    dependencies?: Partial<{ users: UserApi; organizations: OrganizationApi }>;
    config?: Pick<EntitlementConfig, "requestBounds">;
  }>,
): EntitlementModule {
  return EntitlementModule.createForTesting({
    repositories: input.repositories ?? MemoryEntitlementRepositories.create(),
    infrastructure: {
      ...input.infrastructure,
      counter: input.infrastructure.counter ?? TestUsageCounter.create(),
      warnings: input.infrastructure.warnings ?? TestUsageWarnings.create(),
    },
    dependencies: {
      users: input.dependencies?.users ?? createEntitlementTestUsers(),
      organizations:
        input.dependencies?.organizations ??
        createApiFixture<OrganizationApi>({
          countMemberSeats: async () => ({ fullMembers: 0, liteMembers: 0, developers: 0 }),
        }),
    },
    config: input.config,
  });
}
