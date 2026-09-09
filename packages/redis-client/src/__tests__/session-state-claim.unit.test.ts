import { describe, expect, it } from "vitest";
import { SessionStateStoreFactory } from "../session-state.factory.ts";

describe("session state claims", () => {
  it("admits one competing value and renews only that value", async () => {
    let now = 0;
    const store = SessionStateStoreFactory.memory({ now: () => now });
    const claims = await Promise.all([
      store.setIfAbsentOrEqual("claim", "alice", 10),
      store.setIfAbsentOrEqual("claim", "bob", 10),
    ]);
    expect(claims).toEqual([true, false]);
    now = 9000;
    expect(await store.setIfAbsentOrEqual("claim", "alice", 10)).toBe(true);
    now = 11000;
    expect(await store.setIfAbsentOrEqual("claim", "bob", 10)).toBe(false);
    expect(await store.tryGet("claim")).toBe("alice");
    now = 19001;
    expect(await store.setIfAbsentOrEqual("claim", "bob", 10)).toBe(true);
    expect(await store.tryGet("claim")).toBe("bob");
  });
});
