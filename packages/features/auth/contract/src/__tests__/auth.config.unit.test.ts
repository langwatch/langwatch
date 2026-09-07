import { InvalidRuntimeConfigError, RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { assertAuthServerConfig, authServerConfigDefinition } from "../auth.config.ts";

const read = (source: Record<string, unknown>) =>
  RuntimeConfig.create({ name: "auth", definition: authServerConfigDefinition, source }).value;

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
      expect(() => read({ PASSKEYS_ENABLED: "true" })).toThrow(InvalidRuntimeConfigError);
    });
  });

  describe("given only one half of the browser session identity is named", () => {
    /** @scenario "A cross-field rule refuses a half-configured feature at boot" */
    it("refuses the configuration and names both variables", () => {
      expect(() =>
        assertAuthServerConfig({
          sessionSecret: "secret",
          sessionUrl: undefined,
          mfaEnrollmentOpen: false,
          passkeysEnabled: false,
          passkeyHandleSecret: undefined,
        }),
      ).toThrow(/NEXTAUTH_SECRET and NEXTAUTH_URL/);
    });
  });
});
