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

  describe("when the installation names the public URL readers sign in on", () => {
    /** @scenario "The served page carries the public URL readers sign in on" */
    it("hands that URL to the page, and omits it when none is named", async () => {
      await expect(
        authBrowserConfig.project(read({ NEXTAUTH_URL: "https://langwatch.acme.example" }), void 0),
      ).resolves.toMatchObject({ publicUrl: "https://langwatch.acme.example" });
      await expect(authBrowserConfig.project(read({}), void 0)).resolves.not.toHaveProperty(
        "publicUrl",
      );
    });
  });

  describe("given the browser asks whether passwords are on here", () => {
    it("projects the same rule the credential routes mount by", async () => {
      const passwords = async (environment: Record<string, string>) =>
        (await authBrowserConfig.project(read(environment), void 0)).emailPasswordEnabled;

      await expect(passwords({})).resolves.toBe(true);
      await expect(passwords({ IS_SAAS: "true" })).resolves.toBe(true);
      await expect(passwords({ IS_SAAS: "true", AUTH_PROVIDER: "auth0" })).resolves.toBe(false);
      await expect(
        passwords({ IS_SAAS: "true", AUTH_PROVIDER: "auth0", LOCAL_PASSWORDS_ENABLED: "on" }),
      ).resolves.toBe(true);
    });
  });

  describe("given the installation's sign-up mode", () => {
    const signUpMode = async (environment: Record<string, string>) =>
      (await authBrowserConfig.project(read(environment), void 0)).signUpMode;

    /** @scenario "The sign-in screen learns the installation is invite-only" */
    it("hands the page invite_only when it is set, and open otherwise", async () => {
      await expect(signUpMode({ SIGN_UP_MODE: "invite_only" })).resolves.toBe("invite_only");
      await expect(signUpMode({})).resolves.toBe("open");
      await expect(signUpMode({ SIGN_UP_MODE: "" })).resolves.toBe("open");
    });

    it("refuses a mode nothing reads rather than leaving sign-up open", () => {
      expect(() => read({ SIGN_UP_MODE: "closed" })).toThrow(ConfigParseError);
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
            isSaas: false,
            signUpMode: "open",
            publicBaseUrl: undefined,
            nodeEnvironment: undefined,
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
