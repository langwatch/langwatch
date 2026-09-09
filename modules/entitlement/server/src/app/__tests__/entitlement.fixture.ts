import type {
  EntitlementSource,
  Plan,
  SendUsageLimitWarningInput,
  UsageLimitWarning,
  UsageUnit,
} from "@langwatch/entitlement-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import {
  USAGE_UNKNOWN,
  UsageCounterPort,
  type UsageCount,
} from "../../ports/usage-counter.port.ts";
import { UsageWarningPort } from "../../ports/usage-warning.port.ts";
import type { EntitlementRepositories } from "../../repositories/entitlement.repositories.ts";
import { MemoryEntitlementRepositories } from "../../repositories/memory/memory.entitlement.repositories.ts";
import { EntitlementApp, type EntitlementInfrastructure } from "../entitlement.app.ts";

/** A source that always answers the same plan, or none at all. */
export function fixedEntitlementSource(plan: Plan | null): EntitlementSource {
  return { resolve: async () => plan };
}

/** A counter that answers one figure, or {@link USAGE_UNKNOWN}. */
export class TestUsageCounter extends UsageCounterPort {
  static create(
    count: UsageCount = USAGE_UNKNOWN,
    usageUnit: UsageUnit = "traces",
  ): TestUsageCounter {
    return new TestUsageCounter(count, usageUnit);
  }

  private constructor(
    private readonly count: UsageCount,
    private readonly usageUnit: UsageUnit,
  ) {
    super();
  }

  async getCurrentMonthCountForDisplay(): Promise<UsageCount> {
    return this.count;
  }

  async getResolvedUsageUnit(): Promise<UsageUnit> {
    return this.usageUnit;
  }
}

/** A warning sender that records what it was asked and answers what it was told to. */
export class TestUsageWarnings extends UsageWarningPort {
  readonly sent: SendUsageLimitWarningInput[] = [];

  static create(answer: UsageLimitWarning = { sent: false }): TestUsageWarnings {
    return new TestUsageWarnings(answer);
  }

  private constructor(private readonly answer: UsageLimitWarning) {
    super();
  }

  async sendWarning(input: SendUsageLimitWarningInput): Promise<UsageLimitWarning> {
    this.sent.push(input);

    return this.answer;
  }
}

export function createEntitlementTestUsers(): UserApi {
  return createApiFixture<UserApi>({ tryFindById: async () => null });
}

export function createEntitlementTestApp(
  input: Readonly<{
    repositories?: EntitlementRepositories;
    infrastructure: Omit<EntitlementInfrastructure, "counter" | "warnings"> &
      Partial<Pick<EntitlementInfrastructure, "counter" | "warnings">>;
    dependencies?: Partial<{ users: UserApi }>;
  }>,
): EntitlementApp {
  return EntitlementApp.create({
    repositories: input.repositories ?? MemoryEntitlementRepositories.create(),
    infrastructure: {
      ...input.infrastructure,
      counter: input.infrastructure.counter ?? TestUsageCounter.create(),
      warnings: input.infrastructure.warnings ?? TestUsageWarnings.create(),
    },
    dependencies: { users: input.dependencies?.users ?? createEntitlementTestUsers() },
    config: void 0,
    resources: new ResourceScope(),
  });
}
