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
 * are not - `user.register` and `organization.acceptInvite` - exist only to
 * serve them, and the identity wire underneath is better-auth's browser
 * client, which travels here as `behavior/auth-client.tsx`.
 *
 * ONE IDENTITY SEAM. That module builds ONE better-auth client for the whole
 * family and every screen and section reads it; nothing else in this package
 * constructs one, and nothing here logs a credential, a token or a session.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider these
 * hooks run on, the host port that answers for the deployment's public
 * configuration and the address, and - optionally - the error-copy registry
 * (`installAuthErrorExplainer`). NO PAGE GUARD: these screens are the
 * unauthenticated surface, so a permission gate in front of them would be a
 * gate in front of the way in.
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
  AuthHostPort,
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
