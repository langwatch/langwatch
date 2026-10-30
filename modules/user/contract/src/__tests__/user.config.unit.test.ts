import {
  Config,
  localPasswords,
  mfaEnrollmentOpen,
  parseProcessConfig,
  passkeysEnabled,
} from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { userConfig } from "../user.config.ts";

/** A second reader of the same leaves, as auth's configuration is. */
const otherReader = Config.define(() => ({ passkeysEnabled, mfaEnrollmentOpen, localPasswords }));

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({
    owners: [
      { name: "user", config: userConfig },
      { name: "auth", config: otherReader },
    ],
    environment,
  });

describe("user's sign-in capability switches", () => {
  describe("given a deployment that sets the three switches", () => {
    /** @scenario "User reads the passkey, two-step and own-password switches as auth does" */
    it("reads the values the other reader reads, with no collision", () => {
      const parsed = read({
        PASSKEYS_ENABLED: "off",
        MFA_ENROLLMENT_OPEN: "on",
        LOCAL_PASSWORDS_ENABLED: "on",
      });

      expect(parsed.user).toMatchObject({
        passkeysEnabled: false,
        mfaEnrollmentOpen: true,
        localPasswords: true,
      });
      expect(parsed.auth).toEqual({
        passkeysEnabled: false,
        mfaEnrollmentOpen: true,
        localPasswords: true,
      });
    });

    /** @scenario "User reads the passkey, two-step and own-password switches as auth does" */
    it("offers passkeys and nothing else when no switch is set", () => {
      expect(read({}).user).toMatchObject({
        passkeysEnabled: true,
        mfaEnrollmentOpen: false,
        localPasswords: false,
      });
    });
  });

  describe("given a switch written outside on and off", () => {
    /** @scenario "A capability switch written another way reads as the previous release read it" */
    it("reads passkeys as on and the two opt-in switches as off", () => {
      expect(
        read({ PASSKEYS_ENABLED: "true", MFA_ENROLLMENT_OPEN: "yes", LOCAL_PASSWORDS_ENABLED: "1" })
          .user,
      ).toMatchObject({ passkeysEnabled: true, mfaEnrollmentOpen: false, localPasswords: false });
    });
  });
});
