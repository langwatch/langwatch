/**
 * The front door, as the browser application mounts it.
 *
 * EIGHT ADDRESSES, EIGHT SCREENS: sign in, sign up, forgetting a password,
 * resetting one, the verification link's landing, the sign-in error page, the
 * join-before-create step, and the invitation landing. They are the only
 * screens in the product a person reaches with no session at all, which is
 * what makes them one family however differently they are wired.
 *
 * WHY THIS PACKAGE. The credentials family's rule, read strictly: a key
 * belongs to the family that owns its TRANSPORT. Every one of these calls
 * `frontDoor.*` (mounted out of `@langwatch/auth-server`), the two writes that
 * are not — `user.register` and `organization.acceptInvite` — exist only to
 * serve them, and the identity wire underneath is better-auth's browser
 * client, which travels here as `behavior/auth-client.tsx`.
 *
 * ONE IDENTITY SEAM. That module builds ONE better-auth client for the whole
 * family and every screen and section reads it; nothing else in this package
 * constructs one, and nothing here logs a credential, a token or a session.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider these
 * hooks run on, the host port that answers for the deployment's public
 * configuration and the address, and — optionally — the error-copy registry
 * (`installAuthErrorExplainer`). NO PAGE GUARD: these screens are the
 * unauthenticated surface, so a permission gate in front of them would be a
 * gate in front of the way in.
 */

import type { ComponentType } from "react";

export type AuthScreenLoader = () => Promise<{ default: ComponentType }>;

export const authScreens = {
  signin: () => import("./signin.screen"),
  signup: () => import("./signup.screen"),
  forgotPassword: () => import("./forgot-password.screen"),
  resetPassword: () => import("./reset-password.screen"),
  verifyEmail: () => import("./verify-email.screen"),
  signInError: () => import("./sign-in-error.screen"),
  join: () => import("./join.screen"),
  inviteAccept: () => import("./invite-accept.screen"),
} as const satisfies Record<string, AuthScreenLoader>;

export type AuthScreenName = keyof typeof authScreens;

export { authApi } from "../../behavior/auth-api";
export type {
  AuthApiMap,
  AuthInviteLanding,
  AuthViewerCapabilities,
} from "../../behavior/auth-api";
export {
  AuthHostPort,
  AuthHostProvider,
  type AuthErrorExplanation,
  type AuthPublicEnvironment,
  type AuthRouteReading,
} from "../../model/auth-host";
export {
  explainErrorCode,
  installAuthErrorExplainer,
  type ExplainErrorCode,
} from "../../model/error-presentation";
export { frontDoorThemeConfig } from "../../model/front-door-theme";
