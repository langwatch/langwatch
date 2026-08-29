/**
 * The two properties a rollout depends on: raising a percentage never
 * removes anyone, and two flags at the same percentage do not select the
 * same people.
 */
import { describe, expect, it } from "vitest";
import {
  BUCKET_COUNT,
  bucketForSubject,
  hashFeatureFlagSubject,
  isWithinRolloutPercentage,
} from "../feature-flag-bucketing";

const FLAG = "release_ui_navigation_v2_enabled";
const OTHER_FLAG = "release_ui_home_signal_focused_enabled";

function subjects(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `user_${index}`);
}

describe("hashFeatureFlagSubject", () => {
  it("returns the same value for the same input", () => {
    expect(hashFeatureFlagSubject("abc")).toBe(hashFeatureFlagSubject("abc"));
  });

  it("stays inside the unsigned 32-bit range", () => {
    for (const subject of subjects(500)) {
      const hash = hashFeatureFlagSubject(subject);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("separates inputs that differ by one character", () => {
    expect(hashFeatureFlagSubject("user_1")).not.toBe(hashFeatureFlagSubject("user_2"));
  });
});

describe("bucketForSubject", () => {
  it("returns a bucket inside the range for every subject", () => {
    for (const subject of subjects(1_000)) {
      const bucket = bucketForSubject({ flagKey: FLAG, subject });
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(BUCKET_COUNT);
    }
  });

  it("gives one subject different buckets under different flags", () => {
    const differing = subjects(200).filter(
      (subject) =>
        bucketForSubject({ flagKey: FLAG, subject }) !==
        bucketForSubject({ flagKey: OTHER_FLAG, subject }),
    );

    expect(differing.length).toBeGreaterThan(190);
  });
});

describe("isWithinRolloutPercentage", () => {
  describe("given the boundary percentages", () => {
    it("admits nobody at 0", () => {
      const admitted = subjects(1_000).filter((subject) =>
        isWithinRolloutPercentage({ flagKey: FLAG, subject, percentage: 0 }),
      );

      expect(admitted).toHaveLength(0);
    });

    it("admits everybody at 100", () => {
      const admitted = subjects(1_000).filter((subject) =>
        isWithinRolloutPercentage({ flagKey: FLAG, subject, percentage: 100 }),
      );

      expect(admitted).toHaveLength(1_000);
    });
  });

  describe("given a target with no bucketing subject", () => {
    // A system target is not a person, so a percentage rule has nobody to
    // bucket. It is refused at every percentage, 100 included, rather than
    // being admitted as bucket zero or as "everyone".
    it.each([1, 50, 99, 100])("refuses it at %i percent", (percentage) => {
      expect(isWithinRolloutPercentage({ flagKey: FLAG, subject: undefined, percentage })).toBe(
        false,
      );
    });
  });

  describe("when the percentage is raised", () => {
    it("never drops a subject that was already admitted", () => {
      const population = subjects(2_000);
      let previous = new Set<string>();

      for (let percentage = 0; percentage <= 100; percentage += 5) {
        const admitted = new Set(
          population.filter((subject) =>
            isWithinRolloutPercentage({ flagKey: FLAG, subject, percentage }),
          ),
        );

        for (const subject of previous) {
          expect(admitted.has(subject)).toBe(true);
        }
        expect(admitted.size).toBeGreaterThanOrEqual(previous.size);
        previous = admitted;
      }

      expect(previous.size).toBe(population.length);
    });
  });

  describe("when two flags share a percentage", () => {
    it("does not select the same audience", () => {
      const population = subjects(2_000);
      const forFlag = new Set(
        population.filter((subject) =>
          isWithinRolloutPercentage({ flagKey: FLAG, subject, percentage: 10 }),
        ),
      );
      const forOther = population.filter((subject) =>
        isWithinRolloutPercentage({ flagKey: OTHER_FLAG, subject, percentage: 10 }),
      );
      const overlap = forOther.filter((subject) => forFlag.has(subject));

      expect(overlap.length).toBeLessThan(forOther.length);
    });
  });

  describe("given a whole population", () => {
    it("admits roughly the requested share", () => {
      const population = subjects(5_000);
      const admitted = population.filter((subject) =>
        isWithinRolloutPercentage({ flagKey: FLAG, subject, percentage: 25 }),
      );
      const share = (admitted.length / population.length) * 100;

      expect(share).toBeGreaterThan(21);
      expect(share).toBeLessThan(29);
    });
  });
});
