/**
 * Front door with eight unauthenticated screens. Only screens reached without
 * session; mount tRPC Provider, host config, optional error-copy registry.
 */

import type { ComponentType } from "react";

export type AuthScreenLoader = () => Promise<{ default: ComponentType }>;

export const authScreens = {
  signin: () => import("./ui/sections/signin-screen.tsx"),
  signup: () => import("./ui/sections/signup-screen.tsx"),
  forgotPassword: () => import("./ui/sections/forgot-password-screen.tsx"),
  resetPassword: () => import("./ui/sections/reset-password-screen.tsx"),
  verifyEmail: () => import("./ui/sections/verify-email-screen.tsx"),
  signInError: () => import("./ui/sections/sign-in-error-screen.tsx"),
  join: () => import("./ui/sections/join-screen.tsx"),
  inviteAccept: () => import("./ui/sections/invite-accept-screen.tsx"),
} as const satisfies Record<string, AuthScreenLoader>;

export type AuthScreenName = keyof typeof authScreens;

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
