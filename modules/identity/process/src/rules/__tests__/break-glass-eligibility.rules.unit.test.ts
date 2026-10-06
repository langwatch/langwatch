import { SignInMethodPolicyService } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { passwordDoorMounted } from "../break-glass-eligibility.rules.ts";

const policyOf = ({
  provider,
  licensed,
  issuesOwnPasswords = false,
}: {
  provider: string;
  licensed: boolean;
  issuesOwnPasswords?: boolean;
}) =>
  SignInMethodPolicyService.create({
    resolveAuthProvider: async () => provider,
    federationLicensed: async () => licensed,
    offersPasskeys: () => false,
    issuesOwnPasswords: () => issuesOwnPasswords,
    selfHosted: () => false,
  });

describe("passwordDoorMounted", () => {
  /** @scenario "A deployment that mounts no password door cannot promise a way back in" */
  it("is false where a federated provider replaces the password form", async () => {
    const door = passwordDoorMounted(policyOf({ provider: "auth0", licensed: true }));

    await expect(door()).resolves.toBe(false);
  });

  it("is true in email mode, and where a federating deployment issues its own passwords", async () => {
    await expect(
      passwordDoorMounted(policyOf({ provider: "email", licensed: false }))(),
    ).resolves.toBe(true);
    await expect(
      passwordDoorMounted(
        policyOf({ provider: "auth0", licensed: true, issuesOwnPasswords: true }),
      )(),
    ).resolves.toBe(true);
  });
});
