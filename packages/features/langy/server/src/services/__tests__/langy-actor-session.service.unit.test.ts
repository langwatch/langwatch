/**
 * @see specs/langy/langy-api-key-turns.feature
 */
import { FEATURE_FLAGS } from "@langwatch/feature-flag-contract";
import { describe, expect, it } from "vitest";
import type { LangyActorUserReader } from "../langy-actor-session.service";
import { resolveLangyActorSession } from "../langy-actor-session.service";

/**
 * A user directory exposing only the `user.findUnique` the resolver uses.
 * Typed as the reader contract rather than cast to it, so a change to the read
 * this resolver makes breaks the double instead of silently passing through.
 */
const userReader = (
  user: {
    id: string;
    name: string | null;
    email: string | null;
  } | null,
): LangyActorUserReader => ({
  user: { findUnique: async () => user },
});

describe("resolveLangyActorSession", () => {
  /** @scenario The acting identity is loaded from the owner's record, not invented */
  it("uses the API key owner's persisted identity", async () => {
    const result = await resolveLangyActorSession({
      users: userReader({
        id: "user_1",
        name: "Ada Lovelace",
        email: "ada@example.com",
      }),
      userId: "user_1",
    });

    // The GitHub Co-authored-by trailer is derived from name and email, so a
    // stand-in here would sign a real commit with an identity nobody owns.
    expect(result).toEqual({
      ok: true,
      session: {
        user: {
          id: "user_1",
          name: "Ada Lovelace",
          email: "ada@example.com",
        },
      },
    });
  });

  /** @scenario A key whose owning user no longer exists is refused */
  it("refuses an API key whose owning user no longer exists", async () => {
    const result = await resolveLangyActorSession({
      users: userReader(null),
      userId: "user_deleted",
    });

    expect(result).toMatchObject({ ok: false, reason: "actor-missing" });
  });
});

describe("key-authed Langy surface rollback switch", () => {
  /** @scenario The key-authed surface is switched off by default */
  it("is registered off by default and is separate from the Langy kill switch", () => {
    const surface = FEATURE_FLAGS.find(
      (f) => "key" in f && f.key === "release_langy_api_key_turns_enabled",
    );
    const langy = FEATURE_FLAGS.find((f) => "key" in f && f.key === "release_langy_enabled");

    expect(surface).toBeDefined();
    expect(langy).toBeDefined();
    // Closed until someone opts in: shipping the route must not, by itself,
    // open a new way into Langy for any existing project.
    expect((surface as { defaultValue: boolean }).defaultValue).toBe(false);
    // Two distinct keys. Comparing the registry entries by identity would pass
    // unconditionally — `find` returns two different array elements whatever
    // their keys say — so compare the keys themselves.
    expect((surface as { key: string }).key).not.toBe((langy as { key: string }).key);
    // The surface is its own lever, not an alias: exactly one registry entry
    // answers to its key, so opening browser Langy cannot open this route as a
    // side effect.
    expect(
      FEATURE_FLAGS.filter((f) => "key" in f && f.key === "release_langy_api_key_turns_enabled"),
    ).toHaveLength(1);
  });
});
