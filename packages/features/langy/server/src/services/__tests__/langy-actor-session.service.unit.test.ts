import { describe, expect, it } from "vitest";
import type { LangyActorUserReader } from "../langy-actor-session.service";
import { resolveLangyActorSession } from "../langy-actor-session.service";

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
  it("uses the API key owner's persisted identity", async () => {
    const result = await resolveLangyActorSession({
      users: userReader({
        id: "user_1",
        name: "Ada Lovelace",
        email: "ada@example.com",
      }),
      userId: "user_1",
    });

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

  it("refuses an API key whose owning user no longer exists", async () => {
    const result = await resolveLangyActorSession({
      users: userReader(null),
      userId: "user_deleted",
    });

    expect(result).toMatchObject({ ok: false, reason: "actor-missing" });
  });
});
