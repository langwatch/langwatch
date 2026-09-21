/**
 * Redis persistence for the guided onboarding record: one JSON blob per
 * organization, refreshed on every write, absent past a long TTL.
 */
import {
  guidedOnboardingRecordSchema,
  type GuidedOnboardingRecord,
} from "@langwatch/onboarding-contract";
import { SessionStateStoreFactory, type RedisConnection } from "@langwatch/redis-client";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";

import { GuidedOnboardingStateRepository } from "../guided-onboarding-state.repository.ts";

const KEY_PREFIX = "onboarding:guided:";

/** A year: long enough that only an abandoned organization ever ages out. */
const RECORD_TTL_SECONDS = 365 * 24 * 60 * 60;

function keyOf(organizationId: string): string {
  return `${KEY_PREFIX}${organizationId}`;
}

export class RedisGuidedOnboardingStateRepository extends GuidedOnboardingStateRepository {
  private constructor(private readonly store: SessionStateStore) {
    super();
  }

  static create(options: { store: SessionStateStore }): RedisGuidedOnboardingStateRepository {
    return new RedisGuidedOnboardingStateRepository(options.store);
  }

  /** Built straight over a process Redis connection, for composition roots. */
  static fromConnection(redis: RedisConnection): RedisGuidedOnboardingStateRepository {
    return RedisGuidedOnboardingStateRepository.create({
      store: SessionStateStoreFactory.redis(redis),
    });
  }

  async find(organizationId: string): Promise<GuidedOnboardingRecord | null> {
    const raw = await this.store.tryGet(keyOf(organizationId));
    if (raw === null) return null;

    const parsed = guidedOnboardingRecordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }

  async write(organizationId: string, record: GuidedOnboardingRecord): Promise<void> {
    await this.store.set(keyOf(organizationId), JSON.stringify(record), RECORD_TTL_SECONDS);
  }
}
