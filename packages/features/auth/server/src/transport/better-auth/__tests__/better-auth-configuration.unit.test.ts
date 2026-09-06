/**
 * The options the process hands Better Auth, read off the instance it builds.
 * Each one below is a decision a maintainer could undo in a line, and the
 * failure would be an authentication hole rather than a broken screen.
 * @see specs/auth/phase-1-better-auth-config.feature
 */
import { hash } from "bcrypt";
import { describe, expect, it } from "vitest";
import { betterAuthTransportFor } from "./better-auth-transport.test-helpers.ts";

type PasswordVerifier = (input: { password: string; hash: string }) => Promise<boolean>;

const optionsOf = () =>
  betterAuthTransportFor().options as {
    plugins?: Array<{ id?: string }>;
    account?: { accountLinking?: { enabled?: boolean; allowDifferentEmails?: boolean } };
    emailAndPassword?: { password?: { verify?: PasswordVerifier } };
  };

describe("the process's Better Auth transport", () => {
  describe("given the process built it", () => {
    /** @scenario BetterAuth is the live handler */
    it("answers requests through a handler of its own", () => {
      const auth = betterAuthTransportFor();

      expect(typeof auth.handler).toBe("function");
      expect(typeof auth.api.signInEmail).toBe("function");
    });

    /** Impersonation lives in the session row, not in a plugin that would also
     *  bring a whole user-administration surface with it.
     *  @scenario The BetterAuth admin plugin is intentionally omitted */
    it("mounts no administration plugin", () => {
      const ids = (optionsOf().plugins ?? []).map((plugin) => plugin.id ?? "");

      expect(ids).not.toContain("admin");
    });
  });

  describe("when an OAuth profile comes back under a different email", () => {
    /** Linking is enabled so an email-verified account can sign in through a
     *  provider — but only for the SAME email. Allowing a different one would
     *  let a provider hand us any address and have it attached.
     *  @scenario DIFFERENT_EMAIL_NOT_ALLOWED guard */
    it("links only same-email accounts", () => {
      const linking = optionsOf().account?.accountLinking;

      expect(linking?.enabled).toBe(true);
      expect(linking?.allowDifferentEmails).toBeFalsy();
    });
  });

  describe("when a password from the legacy system is checked", () => {
    /** @scenario Legacy bcrypt hashes still verify */
    it("accepts the right password against a bcrypt hash", async () => {
      const verify = optionsOf().emailAndPassword?.password?.verify;
      expect(verify).toBeDefined();

      await expect(verify!({ password: "hunter2", hash: await hash("hunter2", 10) })).resolves.toBe(
        true,
      );
    });

    /** @scenario Wrong password is rejected */
    it("refuses the wrong password against the same hash", async () => {
      const verify = optionsOf().emailAndPassword?.password?.verify;

      await expect(
        verify!({ password: "not-hunter2", hash: await hash("hunter2", 10) }),
      ).resolves.toBe(false);
    });
  });
});
