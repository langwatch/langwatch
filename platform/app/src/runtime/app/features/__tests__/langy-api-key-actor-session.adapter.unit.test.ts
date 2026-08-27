import { describe, expect, it } from "vitest";
import type { LangyActorUserReader } from "../langy-api-key-actor-session.adapter";
import { resolveLangyActorSession } from "../langy-api-key-actor-session.adapter";

const userReader = (
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  } | null,
): LangyActorUserReader => ({
  user: { findUnique: async () => user },
});

const now = new Date("2026-01-01T00:00:00.000Z");

describe("resolveLangyActorSession", () => {
  it("uses the API key owner's persisted identity", async () => {
    const result = await resolveLangyActorSession({
      users: userReader({
        id: "user_1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        image: null,
      }),
      userId: "user_1",
      now,
    });

    expect(result).toEqual({
      ok: true,
      session: {
        user: {
          id: "user_1",
          name: "Ada Lovelace",
          email: "ada@example.com",
          image: null,
        },
        expires: now.toISOString(),
      },
    });
  });

  it("refuses an API key whose owning user no longer exists", async () => {
    const result = await resolveLangyActorSession({
      users: userReader(null),
      userId: "user_deleted",
      now,
    });

    expect(result).toMatchObject({ ok: false, reason: "actor-missing" });
  });
});
