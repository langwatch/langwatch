/**
 * Front door with eight unauthenticated screens. Only screens reached without
 * session; mount tRPC Provider, host config, optional error-copy registry.
 */

export { authApi } from "./behavior/auth-api.ts";
export type { AuthApiMap, AuthInviteLanding } from "./behavior/auth-api.ts";
export {
  AuthHostApi,
  AuthHostProvider,
  type AuthErrorExplanation,
  type AuthFailureNotice,
  type AuthPublicEnvironment,
  type AuthRouteReading,
} from "./model/auth-host.ts";
export {
  explainErrorCode,
  installAuthErrorExplainer,
  type ExplainErrorCode,
} from "./model/error-presentation.ts";
export { frontDoorThemeConfig } from "./model/front-door-theme.ts";
