/**
 * Removing one's own sign-in method through Better Auth's account storage (ADR-116).
 */
import {
  type IdentityApi,
  type IdentityEmailResolution,
  IdentityDetachStrandsUserError,
} from "@langwatch/identity-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  UserLastAuthenticationMethodError,
  UserLinkedAccountNotFoundError,
} from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { OwnSignInMethodService } from "../own-sign-in-method.service.ts";

const LEGACY: IdentityEmailResolution = { kind: "keep_legacy" };
const MOVED: IdentityEmailResolution = { kind: "resolved", email: "ana@acme.com" };

/** `detachGuard` stands in for identity's guard, which a moved account's delete runs. */
function methods(
  accountIds: string[],
  {
    email = LEGACY,
    detachGuard = () => undefined,
  }: { email?: IdentityEmailResolution; detachGuard?: (accountId: string) => void } = {},
) {
  const held = new Set(accountIds);
  const credentials = {
    listAccountIds: vi.fn(async () => [...held]),
    deleteAccount: vi.fn(async ({ accountId }: { accountId: string }) => {
      detachGuard(accountId);
      held.delete(accountId);
    }),
  };
  const identity = createApiFixture<IdentityApi>({ resolveEmail: async () => email });
  return { held, credentials, service: OwnSignInMethodService.create({ credentials, identity }) };
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

  describe("when the account has moved onto identity", () => {
    /** @scenario "A passkey counts as another way in when the password is removed" */
    it("removes the only password when the detach guard keeps a way back", async () => {
      const { held, credentials, service } = methods(["password"], { email: MOVED });

      await service.unlink({ userId: "user-1", accountId: "password" });

      expect(credentials.deleteAccount).toHaveBeenCalledWith({ accountId: "password" });
      expect([...held]).toEqual([]);
    });

    it("answers with the detach guard's refusal and keeps the method", async () => {
      const { held, service } = methods(["password"], {
        email: MOVED,
        detachGuard: () => {
          throw new IdentityDetachStrandsUserError("last way back");
        },
      });

      await expect(
        service.unlink({ userId: "user-1", accountId: "password" }),
      ).rejects.toBeInstanceOf(IdentityDetachStrandsUserError);
      expect([...held]).toEqual(["password"]);
    });
  });
});
