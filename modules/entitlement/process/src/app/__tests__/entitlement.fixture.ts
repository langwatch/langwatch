import type {
  EntitlementConfig,
  EntitlementSource,
  Plan,
  SendUsageLimitWarningInput,
  UsageLimitWarning,
  UsageUnit,
} from "@langwatch/entitlement-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { UserApi } from "@langwatch/user-contract";

import type { EntitlementRepositories } from "../../repositories/entitlement.repositories.ts";
import { MemoryEntitlementRepositories } from "../../repositories/memory/memory.entitlement.repositories.ts";
import { EntitlementApp } from "../entitlement.app.ts";
import type { EntitlementInfrastructure } from "../entitlement.app.ts";
import {
  USAGE_UNKNOWN,
  type UsageCounter,
  type UsageCount,
  type UsageWarning,
} from "../entitlement.members.ts";

/** A source that always answers the same plan, or none at all. */
export function fixedEntitlementSource(plan: Plan | null): EntitlementSource {
  return { resolve: async () => plan };
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
  ) {}

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
}

export function createEntitlementTestUsers(): UserApi {
  return createApiFixture<UserApi>({ findById: async () => null });
}

export function createEntitlementTestApp(
  input: Readonly<{
    repositories?: EntitlementRepositories;
    members: Omit<EntitlementInfrastructure, "counter" | "warnings"> &
      Partial<Pick<EntitlementInfrastructure, "counter" | "warnings">>;
    dependencies?: Partial<{ users: UserApi }>;
    config?: EntitlementConfig;
  }>,
): EntitlementApp {
  return EntitlementApp.createForTesting({
    repositories: input.repositories ?? MemoryEntitlementRepositories.create(),
    members: {
      ...input.members,
      counter: input.members.counter ?? TestUsageCounter.create(),
      warnings: input.members.warnings ?? TestUsageWarnings.create(),
    },
    dependencies: { users: input.dependencies?.users ?? createEntitlementTestUsers() },
    config: input.config,
  });
}
