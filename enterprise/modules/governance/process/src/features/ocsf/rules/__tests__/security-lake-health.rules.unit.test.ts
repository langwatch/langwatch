// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";

import {
  emptySecurityLakeHealth,
  foldSecurityLakeRun,
  parseSecurityLakeHealth,
} from "../security-lake-health.rules.ts";

const RUN = {
  messages: 2,
  objects: 2,
  rows: 10,
  written: 4,
  dropped: 6,
  invalid: 0,
  retried: 0,
  poison: [],
  oldestEventTimeMs: 1_000,
};

describe("security lake health", () => {
  it("starts from zero for a missing or foreign cursor", () => {
    expect(parseSecurityLakeHealth(null)).toEqual(emptySecurityLakeHealth());
    expect(parseSecurityLakeHealth("{not json")).toEqual(emptySecurityLakeHealth());
    expect(parseSecurityLakeHealth('{"page":"x"}')).toEqual(emptySecurityLakeHealth());
  });

  it("sums counts across runs and takes the lag of the last run", () => {
    const first = foldSecurityLakeRun({
      previous: emptySecurityLakeHealth(),
      run: RUN,
      nowMs: 5_000,
    });
    const second = foldSecurityLakeRun({
      previous: parseSecurityLakeHealth(JSON.stringify(first)),
      run: { ...RUN, oldestEventTimeMs: undefined },
      nowMs: 9_000,
    });
    expect(first.lagMs).toBe(4_000);
    expect(second).toMatchObject({
      runs: 2,
      written: 8,
      dropped: 12,
      lagMs: null,
      lastReadAt: 9_000,
    });
  });

  it("keeps only the newest twenty poison entries", () => {
    let health = emptySecurityLakeHealth();
    for (let i = 0; i < 25; i++) {
      const poison = [{ messageId: `m${i}`, key: "k", reason: "unreadable" }];
      health = foldSecurityLakeRun({ previous: health, run: { ...RUN, poison }, nowMs: i });
    }
    expect(health.poisonCount).toBe(25);
    expect(health.poison).toHaveLength(20);
    expect(health.poison.at(-1)?.messageId).toBe("m24");
  });
});
