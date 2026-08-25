import { describe, expect, it } from "vitest";
import { FEATURE_FLAGS } from "~/server/featureFlag/registry";
import type { LangyActorUserReader } from "../langyApiKeyActorSession";
import { resolveLangyActorSession } from "../langyApiKeyActorSession";

/**
 * A prisma stand-in exposing only the `user.findUnique` the resolver uses.
 * Typed as the reader contract rather than cast to it, so a change to the read
 * this resolver makes breaks the double instead of silently passing through.
 */
const prismaWithUser = (
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  } | null,
): LangyActorUserReader => ({
  user: { findUnique: async () => user },
});

const NOW = new Date("2026-01-01T00:00:00.000Z");

describe("resolveLangyActorSession", () => {
  /** @scenario The acting identity is loaded from the owner's record, not invented */
  it("carries the owner's own name and email, with no placeholder actor", async () => {
    const result = await resolveLangyActorSession({
      prisma: prismaWithUser({
        id: "user_1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        image: null,
      }),
      userId: "user_1",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.user.id).toBe("user_1");
    // The GitHub Co-authored-by trailer is derived from these two fields, so a
    // stand-in here would sign a real commit with an identity nobody owns.
    expect(result.session.user.name).toBe("Ada Lovelace");
    expect(result.session.user.email).toBe("ada@example.com");
  });

  /** @scenario A key whose owning user no longer exists is refused */
  it("refuses when the owning user row is gone, rather than substituting one", async () => {
    const result = await resolveLangyActorSession({
      prisma: prismaWithUser(null),
      userId: "user_deleted",
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("actor-missing");
  });
});

describe("key-authed Langy surface rollback switch", () => {
  /** @scenario The key-authed surface is switched off by default */
  it("is registered off by default and is separate from the Langy kill switch", () => {
    const surface = FEATURE_FLAGS.find(
      (f) => "key" in f && f.key === "release_langy_api_key_turns_enabled",
    );
    const langy = FEATURE_FLAGS.find(
      (f) => "key" in f && f.key === "release_langy_enabled",
    );

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
      FEATURE_FLAGS.filter(
        (f) => "key" in f && f.key === "release_langy_api_key_turns_enabled",
      ),
    ).toHaveLength(1);
  });
});
