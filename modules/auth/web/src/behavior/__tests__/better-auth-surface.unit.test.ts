import { describe, expect, it } from "vitest";
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";

/**
 * The browser programs read `packages/browser-types/better-auth-react.d.ts` instead of
 * better-auth's own declarations, which reach a SQL query builder. This suite
 * runs against the REAL package — vitest resolves it normally — so a method
 * the contract promises and the library has dropped fails here rather than in
 * a sign-in nobody type-checked.
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
