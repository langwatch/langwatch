export { AuthDirectoryPort, type AuthDirectoryProject } from "./transport/auth-directory.ts";
export { BetterAuthHooksRepository } from "./repositories/better-auth-hooks.repository.ts";
export { PrismaBetterAuthHooksRepository } from "./repositories/prisma/prisma.better-auth-hooks.repository.ts";
export { PrismaAuthDirectoryRepository } from "./repositories/prisma/prisma.auth-directory.repository.ts";
export {
  AuthApp,
  AuthUnavailableError,
  type AuthAccountRows,
  type AuthInfrastructure,
  type AuthInviteDirectory,
  type AuthSignUpCollaborators,
} from "./app/auth.app.ts";
export { authServer } from "./auth.server.ts";
export {
  SIGN_UP_VERIFICATION_TTL_MS,
  SignUpVerificationService,
  type SignUpAccountDirectory,
  type SignUpAccountFactory,
  type SignUpVerificationDeps,
  type SignUpVerificationMailer,
} from "./services/signup-verification.service.ts";
export { PrismaSignUpAccountDirectoryRepository } from "./repositories/prisma/prisma.signup-account-directory.repository.ts";
export {
  BetterAuthAnnouncementsPort,
  BetterAuthFederationPort,
  BetterAuthIdentityCeremoniesPort,
  BetterAuthPendingInvitePort,
  BetterAuthStoragePort,
  type BetterAuthAccountRow,
  type PendingOrganizationInvite,
} from "./transport/better-auth/better-auth.collaborators.ts";
export {
  createBetterAuthTransport,
  isEmailPasswordEnabled,
  type BetterAuthDeploymentConfiguration,
  type BetterAuthTransport,
  type BetterAuthTransportOptions,
} from "./transport/better-auth/better-auth.api.ts";
export {
  afterAccountCreate,
  afterAccountUpdate,
  afterSessionCreate,
  afterUserCreate,
  tryBeforeAccountCreate,
  beforeSessionCreate,
  beforeUserCreate,
  type BetterAuthHookCollaborators,
} from "./transport/better-auth/better-auth-hooks.api.ts";
export {
  BORN_FINALIZED_SIGNUP_FLAG,
  isBornFinalizedSignUp,
} from "./transport/better-auth/born-finalized-opt-in.api.ts";
export { isAllowedAuthOrigin } from "./transport/better-auth/origin-gate.api.ts";
export {
  PASSKEY_SIGNUP_EMAIL_INVALID,
  PASSKEY_SIGNUP_EMAIL_TAKEN,
  passkeySignUpRegistration,
  type PasskeySignUpDirectory,
  type SignUpVerificationPort,
} from "./transport/better-auth/passkey-sign-up.api.ts";
export {
  isSignInInitiationPath,
  runSignInRouterShadow,
  SignInRouterShadowPort,
  type ShadowRun,
  type SignInRouterMode,
} from "./transport/better-auth/sign-in-router-shadow.api.ts";
export {
  Auth0ApiError,
  Auth0PasswordService,
  buildAuth0Config,
  type Auth0Config,
  type Auth0ErrorCode,
  type Auth0ManagementCredentials,
} from "./services/auth0-password.service.ts";

// The `/api/auth` REST family: the Better Auth catch-all, the browser's
// session poll, the explicit logout and the legacy project-token check. The
// one Better Auth instance arrives on the door's api for the reason
// `ApiAuthComposition` states: a second one verifies nothing and reads as
// "signed out" to every caller.
export {
  authRest,
  AuthDoorApi,
  type AuthRestFederatedLogout,
  type AuthRestSession,
} from "./transport/auth.rest.ts";

// The `/api/auth/cli` device grant: RFC 8628's three CLI endpoints plus the
// four browser-side ones that resolve, approve, deny and end a device session.
// All seven are one family because they are one state machine over one
// keyspace: see the transport's docblock.
export {
  authCliDeviceFlowRest,
  AuthCliDeviceFlowApi,
  type CliBrowserSession,
  type CliPersonalWorkspace,
} from "./transport/auth-cli-device-flow.rest.ts";

// The unauthenticated `frontDoor.*` surface (D13, ADR-117 §6).
export { callerEmailFact, frontDoorTrpcTransport } from "./transport/front-door.trpc.ts";
export type { CliDeviceSessionRepository } from "./repositories/cli-device-session.repository.ts";
export {
  ACCESS_TOKEN_TTL_SECONDS,
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
} from "./services/cli-device-session.service.ts";
