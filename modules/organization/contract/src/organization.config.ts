import {
  adminEmails,
  Config,
  isSaas,
  publicBaseUrl,
  signUpAllowedDomains,
  signUpMode,
  type ConfigOf,
} from "@langwatch/config";

/**
 * The sign-up policy's settings: `SIGN_UP_MODE`, `SIGN_UP_ALLOWED_DOMAINS`, and the addresses
 * `ADMIN_EMAILS` names, which may always sign up. `publicBaseUrl` is the shared deployment origin
 * the invitation links and the sign-up announcement point at.
 */
export const organizationServerConfig = Config.define(() => ({
  signUp: {
    mode: signUpMode,
    allowedDomains: signUpAllowedDomains,
    adminEmails,
  },
  publicBaseUrl,
  /** Whether this is LangWatch Cloud: decides how a seat request is approved (ruling R6). */
  isSaas,
}));

export type OrganizationServerConfig = ConfigOf<typeof organizationServerConfig>;
