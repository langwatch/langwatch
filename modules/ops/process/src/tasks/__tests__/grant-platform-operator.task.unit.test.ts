import { PlatformOperatorUserNotFoundError } from "@langwatch/ops-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { GrantPlatformOperatorTask } from "../grant-platform-operator.task.ts";

const signal = new AbortController().signal;

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
        operators: { grantPlatformOperatorAsSystem },
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
        operators: { grantPlatformOperatorAsSystem },
      });

      await expect(task.run({ args: [], signal })).rejects.toThrow(/email address/);
      expect(grantPlatformOperatorAsSystem).not.toHaveBeenCalled();
    });
  });

  describe("given an address nobody active holds", () => {
    /** @scenario "The recovery task refuses an address nobody active holds" */
    it("fails with the not-found code", async () => {
      const task = GrantPlatformOperatorTask.create({
        operators: {
          grantPlatformOperatorAsSystem: async ({ email }) => {
            throw new PlatformOperatorUserNotFoundError(email);
          },
        },
      });

      await expect(task.run({ args: ["nobody@acme.com"], signal })).rejects.toMatchObject({
        code: "platform_operator_user_not_found",
      });
    });
  });
});
