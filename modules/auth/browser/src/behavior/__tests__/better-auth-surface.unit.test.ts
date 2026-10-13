import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";
import { describe, expect, it } from "vitest";

/**
 * The browser reads a trimmed `better-auth-react.d.ts`, not better-auth's own
 * declarations (which reach a SQL query builder). This suite runs against the
 * REAL package, so a dropped method fails here, not in an unchecked sign-in.
 */
describe("given the browser reads a trimmed better-auth contract", () => {
  const client = createAuthClient({ plugins: [passkeyClient()] });

  describe("when the contract names a method on the client", () => {
    /** @scenario "The trimmed better-auth contract names only methods the library has" */
    it("finds every one of them on the real client", () => {
      const missing = [
        ["$fetch", client.$fetch],
        ["signOut", client.signOut],
        ["getSession", client.getSession],
        ["requestPasswordReset", client.requestPasswordReset],
        ["resetPassword", client.resetPassword],
        ["signIn.email", client.signIn.email],
        ["signIn.social", client.signIn.social],
        ["signIn.passkey", client.signIn.passkey],
        ["passkey.addPasskey", client.passkey.addPasskey],
        ["passkey.listUserPasskeys", client.passkey.listUserPasskeys],
        ["passkey.deletePasskey", client.passkey.deletePasskey],
        ["passkey.updatePasskey", client.passkey.updatePasskey],
      ]
        .filter(([, value]) => typeof value !== "function")
        .map(([name]) => name);

      expect(missing).toEqual([]);
    });
  });
});
