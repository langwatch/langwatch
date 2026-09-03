export {
  SSO_FEATURE_ID,
  ssoConfigurationSchema,
  type SsoConfiguration,
} from "./sso.contract";
export * from "./sso.service";
export {
  extractEmailDomain,
  isSsoProviderMatch,
  type OAuthAccountLike,
} from "./sso-matching";
export {
  GATED_SSO_INITIATION_SUFFIXES,
  isCredentialMutationPath,
  isEmailAuthPath,
  isGateDependentPath,
  isGatedSsoPath,
  isPasswordResetPath,
  normalizedRequestPathname,
  requestPathname,
} from "./sso-path-gate";
