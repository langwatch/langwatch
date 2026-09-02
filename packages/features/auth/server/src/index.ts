export { PostgresAuthAdapter } from "./adapters/postgres.auth.adapter";
export { AuthService } from "./services/auth.service";
export {
  AuthApp,
  type AuthAppDependencies,
  type AuthRequestContext,
  type AuthSession,
  type InviteLanding,
} from "./app/auth.app";
export { FrontDoorTrpcApi, type FrontDoorTrpcContext } from "./transport/api-trpc/front-door.api";
export { PublicEnvTrpcApi, type PublicEnvTrpcContext } from "./transport/api-trpc/public-env.api";
export {
  SIGN_UP_VERIFICATION_TTL_MS,
  SignUpVerificationService,
  type SignUpAccountDirectory,
  type SignUpAccountFactory,
  type SignUpVerificationDeps,
  type SignUpVerificationMailer,
  type SignUpVerificationTokenStore,
} from "./services/signup-verification.service";
export {
  PrismaSignUpAccountDirectory,
  PrismaSignUpVerificationTokenStore,
} from "./repositories/prisma/prisma.signup-verification.repository";
export {
  BetterAuthAnnouncementsPort,
  BetterAuthFederationPort,
  BetterAuthIdentityCeremoniesPort,
  BetterAuthPendingInvitePort,
  BetterAuthStoragePort,
  type BetterAuthAccountRow,
  type PendingOrganizationInvite,
} from "./ports/better-auth.port";
export {
  createBetterAuthTransport,
  isEmailPasswordEnabled,
  type BetterAuthDeploymentConfiguration,
  type BetterAuthTransport,
  type BetterAuthTransportOptions,
} from "./transport/better-auth/better-auth.api";
export {
  afterAccountCreate,
  afterAccountUpdate,
  afterSessionCreate,
  afterUserCreate,
  beforeAccountCreate,
  beforeSessionCreate,
  beforeUserCreate,
  type BetterAuthHookCollaborators,
} from "./transport/better-auth/better-auth-hooks";
export {
  BORN_FINALIZED_SIGNUP_FLAG,
  isBornFinalizedSignUp,
} from "./transport/better-auth/born-finalized-opt-in";
export { isAllowedAuthOrigin } from "./transport/better-auth/origin-gate";
export {
  PASSKEY_SIGNUP_EMAIL_INVALID,
  PASSKEY_SIGNUP_EMAIL_TAKEN,
  passkeySignUpRegistration,
  type SignUpVerificationPort,
} from "./transport/better-auth/passkey-sign-up";
export {
  isSignInInitiationPath,
  runSignInRouterShadow,
  SignInRouterShadowPort,
  type ShadowRun,
  type SignInRouterMode,
} from "./transport/better-auth/sign-in-router-shadow";
export {
  Auth0ApiError,
  changeAuth0Password,
  getManagementApiToken,
  updateUserPassword,
  verifyCurrentPassword,
  _resetManagementApiTokenCache,
  type Auth0ErrorCode,
  type Auth0ManagementCredentials,
} from "./services/auth0-password.service";

// The `/api/auth` REST family: the Better Auth catch-all, the browser's
// session poll, the explicit logout and the legacy project-token check. The
// one Better Auth instance arrives as a port for the reason
// `ApiAuthComposition` states — a second one verifies nothing and reads as
// "signed out" to every caller.
export {
  createAuthRestApp,
  type AuthRestFederatedLogout,
  type AuthRestPorts,
  type AuthRestSession,
} from "./transport/api-rest/auth.api";

// The `/api/auth/cli` device grant: RFC 8628's three CLI endpoints plus the
// four browser-side ones that resolve, approve, deny and end a device session.
// All seven are one family because they are one state machine over one
// keyspace — see the transport's docblock.
export {
  createAuthCliDeviceFlowRestApp,
  type AuthCliDeviceFlowRestPorts,
  type CliBrowserSessionPort,
  type CliPersonalWorkspace,
} from "./transport/api-rest/auth-cli-device-flow.api";
export { CliDeviceSessionStorePort } from "./ports/cli-device-session-store.port";
export {
  ACCESS_TOKEN_TTL_SECONDS,
  bearerCliAccessToken,
  CliDeviceSessionService,
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
  DEVICE_CODE_TTL_SECONDS,
  MIN_POLL_INTERVAL_SECONDS,
  POLL_RATE_LIMIT_SECONDS,
  type CliAccessTokenRecord,
  type CliClientInfo,
  type CliCredentialType,
  type CliDeviceCodeRecord,
  type CliDeviceCodeStatus,
  type CliMintedSession,
  type CliRefreshTokenRecord,
} from "./services/cli-device-session.service";
