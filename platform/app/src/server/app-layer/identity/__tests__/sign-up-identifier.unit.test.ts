import { describe, expect, it, vi } from "vitest";
import { SignUpIdentifierService } from "../sign-up-identifier";

const ACCOUNT_CREATED_AT = new Date("2026-08-20T09:15:00.000Z");

function serviceWith(attachIdentifier: (input: never) => Promise<unknown>) {
  return new SignUpIdentifierService({
    attachIdentifier: attachIdentifier as never,
  });
}

async function attachFor(
  attachIdentifier: (input: never) => Promise<unknown>,
): Promise<void> {
  await serviceWith(attachIdentifier).attachCredentialIdentifier({
    userId: "user_1",
    email: "new@home.net",
    accountId: "account_1",
    occurredAtMs: ACCOUNT_CREATED_AT.getTime(),
  });
}

describe("SignUpIdentifierService", () => {
  describe("when sign-up has written its account rows", () => {
    /** @scenario "An account the sign-up form just made is not mistaken for no account" */
    it("states a credential identifier carrying the address", async () => {
      const attachIdentifier = vi.fn().mockResolvedValue([]);
      await attachFor(attachIdentifier);

      expect(attachIdentifier).toHaveBeenCalledTimes(1);
      expect(attachIdentifier.mock.calls[0]?.[0]).toMatchObject({
        userId: "user_1",
        tenantId: "user_1",
        // Both halves of the routing question: the value is what makes the
        // address resolvable, the provider is what offers the password.
        value: "new@home.net",
        provider: "credential",
        providerId: "credential",
      });
    });

    it("names the account row so the backfill converges instead of duplicating", async () => {
      const attachIdentifier = vi.fn().mockResolvedValue([]);
      await attachFor(attachIdentifier);

      expect(attachIdentifier.mock.calls[0]?.[0]).toMatchObject({
        accountId: "account_1",
        providerAccountId: "user_1",
        // The row's own timestamp, never "now": the identifier id derives
        // from it and the backfill reads it from `Account.createdAt`.
        occurredAtMs: ACCOUNT_CREATED_AT.getTime(),
      });
    });
  });

  describe("when the identity engine cannot take the fact", () => {
    it("leaves the sign-up standing rather than failing an account that exists", async () => {
      const attachIdentifier = vi
        .fn()
        .mockRejectedValue(new Error("the pipeline exposes no sender"));

      await expect(attachFor(attachIdentifier)).resolves.toBeUndefined();
    });
  });
});
