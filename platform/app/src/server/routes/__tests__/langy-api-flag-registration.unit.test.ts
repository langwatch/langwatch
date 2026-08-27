import { describe, expect, it } from "vitest";
import { FEATURE_FLAGS } from "@langwatch/feature-flag-contract";

describe("key-authenticated Langy API registration", () => {
  it("is closed by default and uses a distinct flag from browser Langy", () => {
    const surface = FEATURE_FLAGS.find(
      (flag) => "key" in flag && flag.key === "release_langy_api_key_turns_enabled",
    );
    const langy = FEATURE_FLAGS.find(
      (flag) => "key" in flag && flag.key === "release_langy_enabled",
    );

    expect(surface).toMatchObject({
      key: "release_langy_api_key_turns_enabled",
      defaultValue: false,
    });
    expect(langy).toMatchObject({ key: "release_langy_enabled" });
  });
});
