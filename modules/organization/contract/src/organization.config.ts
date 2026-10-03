import {
  adminEmails,
  Config,
  signUpAllowedDomains,
  signUpMode,
  type ConfigOf,
} from "@langwatch/config";

/**
 * The sign-up policy's settings: `SIGN_UP_MODE`, `SIGN_UP_ALLOWED_DOMAINS`, and the addresses
 * `ADMIN_EMAILS` names, which may always sign up.
 */
export const organizationServerConfig = Config.define(() => ({
  signUp: {
    mode: signUpMode,
    allowedDomains: signUpAllowedDomains,
    adminEmails,
  },
}));

export type OrganizationServerConfig = ConfigOf<typeof organizationServerConfig>;
