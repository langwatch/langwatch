/**
 * The memory and Redis guided onboarding repositories answer alike: absence
 * reads null, a write reads back exactly what was written.
 */
import type { GuidedOnboardingRecord } from "@langwatch/onboarding-contract";
import { SessionStateStoreFactory } from "@langwatch/redis-client";
import { describe, expect, it } from "vitest";

import type { GuidedOnboardingStateRepository } from "../guided-onboarding-state.repository.ts";
import { MemoryGuidedOnboardingStateRepository } from "../memory/memory.guided-onboarding-state.repository.ts";
import { RedisGuidedOnboardingStateRepository } from "../redis/redis.guided-onboarding-state.repository.ts";

const RECORD: GuidedOnboardingRecord = {
  state: { paths: ["gateway"], donePaths: [], currentPath: "gateway" },
  variant: "guided",
};

function backends(): Record<string, () => GuidedOnboardingStateRepository> {
  return {
    memory: () => MemoryGuidedOnboardingStateRepository.create(),
    redis: () =>
      RedisGuidedOnboardingStateRepository.create({ store: SessionStateStoreFactory.memory() }),
  };
}

describe.each(Object.entries(backends()))(
  "%s guided onboarding state repository",
  (_name, build) => {
    describe("when no record exists for the organization", () => {
      /** @scenario "the memory and Redis guided onboarding repositories answer alike" */
      it("answers absence with null", async () => {
        const repository = build();

        await expect(repository.find("org_missing")).resolves.toBeNull();
      });
    });

    describe("when a record is written and read back", () => {
      it("reads back exactly what was written", async () => {
        const repository = build();

        await repository.write("org_1", RECORD);

        await expect(repository.find("org_1")).resolves.toEqual(RECORD);
      });

      it("keeps organizations independent", async () => {
        const repository = build();

        await repository.write("org_1", RECORD);

        await expect(repository.find("org_2")).resolves.toBeNull();
      });

      it("replaces the whole record on a second write", async () => {
        const repository = build();
        await repository.write("org_1", RECORD);

        const next: GuidedOnboardingRecord = {
          state: { ...RECORD.state, donePaths: ["gateway"] },
          variant: "guided",
        };
        await repository.write("org_1", next);

        await expect(repository.find("org_1")).resolves.toEqual(next);
      });
    });
  },
);

describe("the Redis repository against a corrupted blob", () => {
  /** @scenario "a corrupted stored blob reads as absent rather than a crash" */
  it("reads a value that fails the schema as null", async () => {
    const store = SessionStateStoreFactory.memory();
    await store.set("onboarding:guided:org_1", JSON.stringify({ not: "a record" }), 3600);
    const repository = RedisGuidedOnboardingStateRepository.create({ store });

    await expect(repository.find("org_1")).resolves.toBeNull();
  });
});
