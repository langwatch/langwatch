import { describe, expect, it } from "vitest";

import { signInLockReapStateSchema } from "../sign-in-lock-reap.process.ts";

describe("process state stored by the main release", () => {
  it("parses a sign-in lock reap state as main stored it", () => {
    expect(signInLockReapStateSchema.parse({ lastReapAt: 1 })).toEqual({ lastReapAt: 1 });
  });
});
