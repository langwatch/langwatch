import { defineRepositories } from "@langwatch/kernel";
import type { RedisConnection } from "@langwatch/redis-client";

import type { GuidedOnboardingStateRepository } from "./guided-onboarding-state.repository.ts";
import { MemoryGuidedOnboardingStateRepository } from "./memory/memory.guided-onboarding-state.repository.ts";
import { RedisGuidedOnboardingStateRepository } from "./redis/redis.guided-onboarding-state.repository.ts";

/** The rows the onboarding module keeps outside the modules it does not own. */
export interface OnboardingRepositories {
  readonly guidedOnboardingState: GuidedOnboardingStateRepository;
}

class RedisOnboardingRepositories {
  static readonly requires = ["redis"] as const;

  static create(members: Readonly<{ redis: RedisConnection }>): OnboardingRepositories {
    return {
      guidedOnboardingState: RedisGuidedOnboardingStateRepository.fromConnection(members.redis),
    };
  }
}

class MemoryOnboardingRepositories {
  static readonly requires = [] as const;

  static create(): OnboardingRepositories {
    return { guidedOnboardingState: MemoryGuidedOnboardingStateRepository.create() };
  }
}

export const onboardingRepositories = defineRepositories({
  live: RedisOnboardingRepositories,
  memory: MemoryOnboardingRepositories,
});
