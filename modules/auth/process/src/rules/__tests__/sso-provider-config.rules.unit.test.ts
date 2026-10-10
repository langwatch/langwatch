import { sso } from "@better-auth/sso";
import { sealedProviderConfigCipher } from "@langwatch/identity-contract";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";

import { openingSsoProviderConfigs } from "../sso-provider-config.rules.ts";

const cipher = sealedProviderConfigCipher({
  encrypt: (plaintext) => Buffer.from(plaintext).toString("base64"),
  decrypt: (ciphertext) => Buffer.from(ciphertext, "base64").toString("utf8"),
});

const DOCUMENT = JSON.stringify({ clientId: "client-1", clientSecret: "shhh" });

function sealedStorage() {
  const database = {
    ssoProvider: [
      {
        id: "connection_1",
        providerId: "connection_1",
        issuer: "https://idp.acme.test",
        domain: "acme.test",
        oidcConfig: cipher.seal(DOCUMENT),
        samlConfig: null,
      },
    ],
  };
  return openingSsoProviderConfigs({
    adapter: memoryAdapter(database)({ plugins: [sso()] }),
    cipher,
  });
}

const lock = {
  model: "ssoProvider",
  where: [{ field: "id", value: "connection_1" }],
  update: { providerId: "connection_1" },
};

describe("given identity stored a provider row with its dialing document sealed", () => {
  describe("when single sign-on locks the row through an update", () => {
    /** @scenario "A sealed provider row reads back opened wherever single sign-on reads it" */
    it("hands back the opened document", async () => {
      const row = await sealedStorage().update<{ oidcConfig: string }>(lock);

      expect(row?.oidcConfig).toBe(DOCUMENT);
    });

    /** @scenario "A sealed provider row reads back opened wherever single sign-on reads it" */
    it("hands back the opened document inside a transaction", async () => {
      const storage = sealedStorage();

      const row = await storage.transaction((trx) => trx.update<{ oidcConfig: string }>(lock));

      expect(row?.oidcConfig).toBe(DOCUMENT);
    });
  });
});
