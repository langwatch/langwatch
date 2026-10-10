/**
 * Removing one's own sign-in method through Better Auth's account storage (ADR-116).
 */
import {
  UserLastAuthenticationMethodError,
  UserLinkedAccountNotFoundError,
} from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { OwnSignInMethodService } from "../own-sign-in-method.service.ts";

function methods(accountIds: string[]) {
  const held = new Set(accountIds);
  const credentials = {
    listAccountIds: vi.fn(async () => [...held]),
    deleteAccount: vi.fn(async ({ accountId }: { accountId: string }) => {
      held.delete(accountId);
    }),
  };
  return { held, credentials, service: OwnSignInMethodService.create({ credentials }) };
}

describe("removing one of my own sign-in methods", () => {
  /** @scenario "A removed sign-in method no longer signs in" */
  it("deletes it through the account storage sign-in reads", async () => {
    const { held, credentials, service } = methods(["password", "github"]);

    await service.unlink({ userId: "user-1", accountId: "github" });

    expect(credentials.deleteAccount).toHaveBeenCalledWith({ accountId: "github" });
    expect([...held]).toEqual(["password"]);
  });

  it("refuses the last way in and removes nothing", async () => {
    const { credentials, service } = methods(["password"]);

    await expect(
      service.unlink({ userId: "user-1", accountId: "password" }),
    ).rejects.toBeInstanceOf(UserLastAuthenticationMethodError);
    expect(credentials.deleteAccount).not.toHaveBeenCalled();
  });

  it("refuses an account that is not the caller's", async () => {
    const { credentials, service } = methods(["password", "github"]);

    await expect(
      service.unlink({ userId: "user-1", accountId: "someone-elses" }),
    ).rejects.toBeInstanceOf(UserLinkedAccountNotFoundError);
    expect(credentials.deleteAccount).not.toHaveBeenCalled();
  });
});
