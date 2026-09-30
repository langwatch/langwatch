import { ConfigParseError, parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { assertAuthServerConfig, authBrowserConfig, authServerConfig } from "../auth.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [{ name: "auth", config: authServerConfig }], environment }).auth;

describe("auth server configuration", () => {
  describe("given the passkey switch is written the way the deployment reads it", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads passkeys and two-step enrollment through the auth schema", () => {
      expect(read({ PASSKEYS_ENABLED: "on" }).passkeysEnabled).toBe(true);
      expect(read({ MFA_ENROLLMENT_OPEN: "on" }).mfaEnrollmentOpen).toBe(true);
    });
  });

  describe("given an installation that has not turned passkeys off", () => {
    /** @scenario "A passkey is offered on every deployment, not on some of them" */
    it("offers passkeys, whether or not two-step enrollment is open", () => {
      expect(read({}).passkeysEnabled).toBe(true);
      expect(read({ MFA_ENROLLMENT_OPEN: "on" }).passkeysEnabled).toBe(true);
      expect(read({ PASSKEYS_ENABLED: "on" }).passkeysEnabled).toBe(true);
    });
  });

  describe("given an operator who turned passkeys off", () => {
    /** @scenario "An operator can turn passkeys off for the whole deployment" */
    it("offers no passkey anywhere the switch reaches", () => {
      expect(read({ PASSKEYS_ENABLED: "off" }).passkeysEnabled).toBe(false);
      expect(read({ PASSKEYS_ENABLED: "off", MFA_ENROLLMENT_OPEN: "on" }).passkeysEnabled).toBe(
        false,
      );
    });
  });

  describe("given the passkey switch is written a way nothing reads", () => {
    /** @scenario "An unreadable switch is refused instead of read as off" */
    it("refuses the boot rather than leaving the surface quietly off", () => {
      expect(() => read({ PASSKEYS_ENABLED: "true" })).toThrow(ConfigParseError);
    });
  });

  describe("given the browser config the served page carries", () => {
    /** @scenario "The served page names the identifier-first screens as the sign-in front door" */
    it("names the identifier-first screens as the front door with no switch set", async () => {
      await expect(authBrowserConfig.project(read({}), undefined)).resolves.toMatchObject({
        identityFrontDoor: true,
      });
      await expect(
        authBrowserConfig.project(read({ PASSKEYS_ENABLED: "on" }), undefined),
      ).resolves.toMatchObject({ identityFrontDoor: true });
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
            auth0ManagementClientId: undefined,
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
