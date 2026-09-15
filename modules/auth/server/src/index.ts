export { AuthDirectory, type AuthDirectoryProject } from "./transport/auth-directory.ts";
export type {
  AuthAccountRows,
  AuthInfrastructure,
  AuthInviteDirectory,
  AuthSignUpCollaborators,
} from "./app/auth.app.ts";
export { authServer } from "./auth.server.ts";
export type {
  SignUpAccountDirectory,
  SignUpAccountFactory,
  SignUpVerificationDeps,
  SignUpVerificationMailer,
} from "./services/signup-verification.service.ts";
export {
  BetterAuthAnnouncements,
  BetterAuthFederation,
  BetterAuthIdentityCeremonies,
  BetterAuthPendingInvite,
  BetterAuthStorage,
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
  type SignUpVerification,
} from "./transport/better-auth/passkey-sign-up.api.ts";
export {
  isSignInInitiationPath,
  runSignInRouterShadow,
  SignInRouterShadow,
  type ShadowRun,
  type SignInRouterMode,
} from "./transport/better-auth/sign-in-router-shadow.api.ts";
export type {
  Auth0Config,
  Auth0ErrorCode,
  Auth0ManagementCredentials,
} from "./services/auth0-password.service.ts";

// The `/api/auth` REST family: the Better Auth catch-all, the browser's
// session poll, the explicit logout and the legacy project-token check. The
// one Better Auth instance arrives on the door's api for the reason
// `ApiAuthComposition` states: a second one verifies nothing and reads as
// "signed out" to every caller.
export {
  authRest,
  type AuthDoorApi,
  type AuthRestFederatedLogout,
  type AuthRestSession,
} from "./transport/auth.rest.ts";

// The `/api/auth/cli` device grant: RFC 8628's three CLI endpoints plus the
// four browser-side ones that resolve, approve, deny and end a device session.
// All seven are one family because they are one state machine over one
// keyspace: see the transport's docblock.
export {
  authCliDeviceFlowRest,
  type AuthCliDeviceFlowApi,
  type CliBrowserSession,
  type CliPersonalWorkspace,
} from "./transport/auth-cli-device-flow.rest.ts";

// The unauthenticated `frontDoor.*` surface (D13, ADR-117 §6).
export { callerEmailFact, frontDoorTrpcTransport } from "./transport/front-door.trpc.ts";
export type { CliDeviceSessionRepository } from "./repositories/cli-device-session.repository.ts";
export type {
  CliAccessTokenRecord,
  CliClientInfo,
  CliCredentialType,
  CliDeviceCodeRecord,
  CliDeviceCodeStatus,
  CliMintedSession,
  CliRefreshTokenRecord,
} from "./services/cli-device-session.service.ts";
