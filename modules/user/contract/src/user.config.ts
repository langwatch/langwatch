import {
  Config,
  type ConfigOf,
  localPasswords,
  mfaEnrollmentOpen,
  passkeysEnabled,
  publicBaseUrl,
} from "@langwatch/config";

/** The deployment facts user reads: where a budget-increase mail links, and the switches. */
export const userConfig = Config.define(() => ({
  /** The shared deployment origin; absent, a budget-increase request is refused by name. */
  publicBaseUrl,
  /** The sign-in capability switches auth builds from (round 48, A1-a): the offer and passwords. */
  passkeysEnabled,
  mfaEnrollmentOpen,
  localPasswords,
}));

export type UserServerConfig = ConfigOf<typeof userConfig>;
