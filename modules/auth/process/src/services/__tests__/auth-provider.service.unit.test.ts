/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { AuthProviderService } from "../auth-provider.service.ts";

const provider = (input: { configured: string; mounted: boolean; licensed: boolean }) =>
  AuthProviderService.create({
    configuredProvider: input.configured,
    providerMounted: input.mounted,
    platformSsoAllowed: async () => input.licensed,
  }).resolve();

describe("AuthProviderService", () => {
  it("answers the configured provider when it is licensed and mounted", async () => {
    await expect(provider({ configured: "okta", mounted: true, licensed: true })).resolves.toBe(
      "okta",
    );
  });

  it("falls back to email mode when the licence denies single sign-on", async () => {
    await expect(provider({ configured: "okta", mounted: true, licensed: false })).resolves.toBe(
      "email",
    );
  });

  it("falls back to email mode when the named provider never mounted", async () => {
    await expect(provider({ configured: "okta", mounted: false, licensed: true })).resolves.toBe(
      "email",
    );
  });

  it("answers email without asking the licence when email is configured", async () => {
    await expect(
      AuthProviderService.create({
        configuredProvider: "email",
        providerMounted: false,
        platformSsoAllowed: async () => {
          throw new Error("asked the licence");
        },
      }).resolve(),
    ).resolves.toBe("email");
  });
});
