import {
  Config,
  type ConfigOf,
  environmentOneOrTrueSchema,
  localPasswords,
  mfaEnrollmentOpen,
  passkeysEnabled,
  publicBaseUrl,
} from "@langwatch/config";

/** The deployment facts user reads: where a budget-increase mail links, and the switches. */
export const userConfig = Config.define((c) => ({
  /** The shared deployment origin; absent, a budget-increase request is refused by name. */
  publicBaseUrl,
  /** The sign-in capability switches auth builds from (round 48, A1-a): the offer and passwords. */
  passkeysEnabled,
  mfaEnrollmentOpen,
  localPasswords,
  /** Air-gapped installs set it: the sidebar's "What's new" never calls langwatch.ai. */
  whatsNewDisabled: c.env("DISABLE_WHATS_NEW", environmentOneOrTrueSchema),
}));

export type UserServerConfig = ConfigOf<typeof userConfig>;
