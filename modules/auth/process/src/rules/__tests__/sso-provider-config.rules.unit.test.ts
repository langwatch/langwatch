/**
 * @vitest-environment node
 * Every provider row the engine is handed carries its dialing document opened,
 * whichever storage call produced it, while the stored row stays sealed.
 */
import { sso } from "@better-auth/sso";
import { sealedProviderConfigCipher } from "@langwatch/identity-contract";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";

import { openingSsoProviderConfigs } from "../sso-provider-config.rules.ts";

const cipher = sealedProviderConfigCipher({
  encrypt: (plaintext) => Buffer.from(plaintext).toString("base64"),
  decrypt: (ciphertext) => Buffer.from(ciphertext, "base64").toString("utf8"),
});

const DIALING_DOCUMENT = JSON.stringify({
  clientId: "client-1",
  clientSecret: "shhh",
  discoveryEndpoint: "https://idp.acme.test/.well-known/openid-configuration",
});

const PROVIDER = [{ field: "providerId", value: "connection_1" }];

function storageHolding({ oidcConfig }: { oidcConfig: string }) {
  const database = {
    ssoProvider: [
      {
        id: "connection_1",
        providerId: "connection_1",
        organizationId: "org_1",
        issuer: "https://idp.acme.test",
        domain: "acme.test",
        userId: null,
        samlConfig: null,
        oidcConfig,
      },
    ],
  };
  const adapter = openingSsoProviderConfigs({
    adapter: memoryAdapter(database)({ plugins: [sso()] }),
    cipher,
  });

  return { adapter, database };
}

type ProviderRow = { oidcConfig: string | null };

describe("given a provider row whose dialing document identity sealed", () => {
  describe("when the engine locks the row by updating it", () => {
    /** @scenario "The row the engine locks carries the opened dialing document" */
    it("hands back the opened document and leaves the stored one sealed", async () => {
      const sealed = cipher.seal(DIALING_DOCUMENT);
      const { adapter, database } = storageHolding({ oidcConfig: sealed });

      const locked = await adapter.update<ProviderRow>({
        model: "ssoProvider",
        where: PROVIDER,
        update: { providerId: "connection_1" },
      });

      expect(locked?.oidcConfig).toBe(DIALING_DOCUMENT);
      expect(database.ssoProvider[0]?.oidcConfig).toBe(sealed);
    });
  });

  describe("when the engine reads the row", () => {
    it("hands back the same opened document the lock does", async () => {
      const { adapter } = storageHolding({ oidcConfig: cipher.seal(DIALING_DOCUMENT) });

      const read = await adapter.findOne<ProviderRow>({ model: "ssoProvider", where: PROVIDER });

      expect(read?.oidcConfig).toBe(DIALING_DOCUMENT);
    });
  });
});

describe("given a provider row written before the seal", () => {
  describe("when the engine locks the row by updating it", () => {
    it("passes the plaintext document through", async () => {
      const { adapter } = storageHolding({ oidcConfig: DIALING_DOCUMENT });

      const locked = await adapter.update<ProviderRow>({
        model: "ssoProvider",
        where: PROVIDER,
        update: { providerId: "connection_1" },
      });

      expect(locked?.oidcConfig).toBe(DIALING_DOCUMENT);
    });
  });
});
