/**
 * The internal bearer door (cron, instance-admin) admits only its configured secret, and
 * compares it in constant time.
 */
import type * as NodeCrypto from "node:crypto";
import { timingSafeEqual } from "node:crypto";

import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const SECRET = "cron-secret-value";

// Loaded fresh, under this file's node:crypto mock. Test files share one
// module registry, so a static import can return an api-surface instance
// another file already evaluated, bound to the real timingSafeEqual: the door
// still admits the caller and the spy below sees no calls. Resetting first
// makes the assertion depend on the door, not on what ran before it.
vi.resetModules();
const { bearerDoor } = await import("../api-surface.ts");
const door = bearerDoor({ name: "cron", token: SECRET });

function presenting(authorization: string) {
  if (!door.identify) throw new Error("the bearer door identifies no one");
  const request = new Request("http://localhost/api/cron/run", { headers: { authorization } });

  return door.identify({ request });
}

function refusalCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof HandledError) return error.code;
    throw error;
  }
  throw new Error("the door admitted the request");
}

describe("the cron bearer door", () => {
  describe("given the configured secret", () => {
    it("admits the caller as the internal secret, comparing in constant time", async () => {
      vi.mocked(timingSafeEqual).mockClear();

      const caller = await presenting(`Bearer ${SECRET}`);

      expect(caller.internal).toEqual({ type: "internalSecret", secretName: "cron" });
      expect(timingSafeEqual).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a wrong secret of the same length", () => {
    it("refuses it as unverified", () => {
      const wrong = "x".repeat(SECRET.length);

      expect(refusalCode(() => presenting(`Bearer ${wrong}`))).toBe("unauthorized");
    });
  });

  describe("given a secret of a different length", () => {
    it("refuses it as unverified rather than failing the comparison", () => {
      const code = refusalCode(() => presenting(`Bearer ${SECRET}x`));

      expect(code).toBe("unauthorized");
    });
  });
});
