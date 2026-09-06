/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";
import { beforeSessionCreate } from "../better-auth-hooks.api";
import type { BetterAuthHooksRepository } from "../../../repositories/better-auth-hooks.repository";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

function repoAnswering(deactivatedAt: Date | null) {
  const tryFindUserForHooks = vi.fn(async () => ({
    id: "user-1",
    email: "user@example.com",
    deactivatedAt,
    pendingSsoSetup: false,
  }));
  return {
    repo: { tryFindUserForHooks } as unknown as BetterAuthHooksRepository,
    tryFindUserForHooks,
  };
}

describe("beforeSessionCreate", () => {
  describe("given a user account with a non-null deactivatedAt", () => {
    describe("when a session is about to be created for them", () => {
      /** @scenario "Deactivated user is blocked from signing in" */
      /** @scenario "Deactivated user is blocked" */
      it("denies the sign-in", async () => {
        const { repo } = repoAnswering(new Date("2026-01-01T00:00:00.000Z"));

        await expect(beforeSessionCreate({ repo, session: { userId: "user-1" } })).resolves.toBe(
          false,
        );
      });
    });
  });

  describe("given a user account with deactivatedAt null", () => {
    describe("when a session is about to be created for them", () => {
      /** @scenario "Active user is not blocked from signing in" */
      it("leaves the sign-in to continue", async () => {
        const { repo, tryFindUserForHooks } = repoAnswering(null);

        await expect(
          beforeSessionCreate({ repo, session: { userId: "user-1" } }),
        ).resolves.toBeUndefined();
        expect(tryFindUserForHooks).toHaveBeenCalled();
      });
    });
  });
});
