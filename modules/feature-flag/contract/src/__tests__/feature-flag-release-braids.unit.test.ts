/**
 * `release_braids` is the kill switch for braid management, on by default (Alex, 2026-11-18).
 * @see modules/authz/specs/braids-release-flag.feature
 */
import { describe, expect, it } from "vitest";

import { FEATURE_FLAGS } from "../feature-flag.ts";

describe("the release_braids kill switch", () => {
  /** @scenario "release_braids is on by default" */
  it("is a product flag, on by default", () => {
    const flag = FEATURE_FLAGS.find((f) => f.key === "release_braids");
    expect(flag).toMatchObject({ scope: "PRODUCT", defaultValue: true });
  });
});
