import { AuthzGrantNotConfirmedError } from "@langwatch/authz-contract";
import type * as observabilityModule from "@langwatch/observability";
import { PlatformOperatorUserNotFoundError } from "@langwatch/ops-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { GrantPlatformOperatorTask } from "../grant-platform-operator.task.ts";

const { info } = vi.hoisted(() => ({ info: vi.fn() }));

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof observabilityModule>()),
  createLogger: () => ({ debug: vi.fn(), info, warn: vi.fn(), error: vi.fn() }),
}));

const signal = new AbortController().signal;
const wait = { timeoutMs: 40, initialDelayMs: 1, maxDelayMs: 4 };

function holder(email: string) {
  return {
    grantId: "grant_1",
    userId: "user_ana",
    name: "Ana",
    email,
    grantedAt: Temporal.Instant.fromEpochMilliseconds(0),
  };
}

describe("GrantPlatformOperatorTask", () => {
  describe("given an address an active account holds", () => {
    /** @scenario "The recovery task grants the role as the system" */
    it("grants through the system path with that address", async () => {
      const grantPlatformOperatorAsSystem = vi.fn(async ({ email }: { email: string }) => ({
        grantId: "grant_1",
        userId: "user_ana",
        name: "Ana",
        email,
        grantedAt: Temporal.Instant.fromEpochMilliseconds(0),
      }));
      const task = GrantPlatformOperatorTask.create({
        operators: { grantPlatformOperatorAsSystem, listPlatformOperators: vi.fn() },
      });

      expect(task.name).toBe("grant-platform-operator");
      await task.run({ args: ["ana@acme.com"], signal });

      expect(grantPlatformOperatorAsSystem).toHaveBeenCalledWith({ email: "ana@acme.com" });
    });
  });

  describe("given no address", () => {
    it("refuses before granting anything", async () => {
      const grantPlatformOperatorAsSystem = vi.fn();
      const task = GrantPlatformOperatorTask.create({
        operators: { grantPlatformOperatorAsSystem, listPlatformOperators: vi.fn() },
      });

      await expect(task.run({ args: [], signal })).rejects.toThrow(/email address/);
      expect(grantPlatformOperatorAsSystem).not.toHaveBeenCalled();
    });
  });

  describe("given an address nobody active holds", () => {
    /** @scenario "The recovery task refuses an address nobody active holds" */
    it("fails with the not-found code and waits for nothing", async () => {
      const listPlatformOperators = vi.fn();
      const task = GrantPlatformOperatorTask.create({
        operators: {
          grantPlatformOperatorAsSystem: async () => {
            throw new PlatformOperatorUserNotFoundError();
          },
          listPlatformOperators,
        },
      });

      await expect(task.run({ args: ["nobody@acme.com"], signal })).rejects.toMatchObject({
        code: "platform_operator_user_not_found",
      });
      expect(listPlatformOperators).not.toHaveBeenCalled();
    });
  });

  describe("given the grant is accepted but its projection has not confirmed it yet", () => {
    const unconfirmed = async () => {
      throw new AuthzGrantNotConfirmedError();
    };

    describe("when the grant is applied within the wait", () => {
      /** @scenario "The recovery task waits for a grant that is still being applied" */
      it("succeeds once the holder is readable", async () => {
        const listPlatformOperators = vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValue([holder("Ana@Acme.com")]);
        const task = GrantPlatformOperatorTask.create({
          operators: { grantPlatformOperatorAsSystem: unconfirmed, listPlatformOperators },
          wait: { ...wait, timeoutMs: 5_000 },
        });

        await expect(task.run({ args: ["ana@acme.com"], signal })).resolves.toBeUndefined();
        expect(listPlatformOperators).toHaveBeenCalledTimes(2);
      });
    });

    describe("when the grant is still not applied at the bound", () => {
      /** @scenario "The recovery task succeeds with a grant still being applied at its bound" */
      it("exits cleanly and says the grant is recorded and still being applied", async () => {
        info.mockClear();
        const listPlatformOperators = vi.fn().mockResolvedValue([]);
        const task = GrantPlatformOperatorTask.create({
          operators: { grantPlatformOperatorAsSystem: unconfirmed, listPlatformOperators },
          wait,
        });

        await expect(task.run({ args: ["ana@acme.com"], signal })).resolves.toBeUndefined();
        expect(info.mock.calls.at(-1)?.[1]).toMatch(/grant recorded; still being applied/);
      });
    });
  });
});
