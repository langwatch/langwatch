import { ConfigParseError, parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { assertAuthServerConfig, authServerConfig } from "../auth.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [{ name: "auth", config: authServerConfig }], environment }).auth;

describe("auth server configuration", () => {
  describe("given the passkey switch is written the way the deployment reads it", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("turns passkeys on for the literal on and off when unset", () => {
      expect(read({ PASSKEYS_ENABLED: "on" }).passkeysEnabled).toBe(true);
      expect(read({}).passkeysEnabled).toBe(false);
      expect(read({ MFA_ENROLLMENT_OPEN: "on" }).mfaEnrollmentOpen).toBe(true);
    });
  });

  describe("given the passkey switch is written a way nothing reads", () => {
    /** @scenario "An unreadable switch is refused instead of read as off" */
    it("refuses the boot rather than leaving the surface quietly off", () => {
      expect(() => read({ PASSKEYS_ENABLED: "true" })).toThrow(ConfigParseError);
    });
  });

  describe("given only one half of the browser session identity is named", () => {
    /** @scenario "A cross-field rule refuses a half-configured feature at boot" */
    it("refuses the configuration and names both variables", () => {
      expect(() =>
        assertAuthServerConfig(
          {
            sessionUrl: undefined,
            mfaEnrollmentOpen: false,
            passkeysEnabled: false,
            passkeyHandleSecret: undefined,
            trustedIdpOrigins: undefined,
            idpSimulatorUrl: undefined,
            localPasswords: false,
            signInProviders: {
              authProvider: undefined,
              legacyProvider: undefined,
              googleClientId: undefined,
              githubClientId: undefined,
              gitlabClientId: undefined,
              azureAdClientId: undefined,
              azureAdTenantId: undefined,
              auth0ClientId: undefined,
              auth0Issuer: undefined,
              oktaClientId: undefined,
              oktaIssuer: undefined,
              cognitoClientId: undefined,
              cognitoIssuer: undefined,
              oneLoginClientId: undefined,
              oneLoginIssuer: undefined,
              oidcClientId: undefined,
              oidcIssuer: undefined,
            },
          },
          "secret",
        ),
      ).toThrow(/NEXTAUTH_SECRET and NEXTAUTH_URL/);
    });
  });
});
