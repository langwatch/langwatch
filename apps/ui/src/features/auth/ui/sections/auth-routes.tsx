/**
 * Which page keys the front door answers, and what they are wrapped in.
 *
 * EIGHT KEYS, EIGHT SCREENS, ONE WRAPPER — and the wrapper is the whole story
 * of how this family differs from every one before it. There is NO
 * `withUiPageGuard` here, and there must not be: these are the addresses a
 * person reaches with no session at all, so a permission gate in front of them
 * would be a gate in front of the way in. The guard exists to refuse; the
 * front door exists to admit.
 *
 * There is no settings chrome either, and no page layout. A front-door screen
 * paints its own ground — that is what `FrontDoorShell` is — and the seven
 * legacy screens are cards on a plain page.
 */

import { authScreens } from "@langwatch/auth-web/screens/auth";
import type { ComponentType } from "react";

import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { withAuthHost } from "./auth-host-provider";

/** One screen, hosted, under the name a stack trace should show. */
function frontDoorPage(
  load: () => Promise<{ default: ComponentType }>,
  displayName: string,
): UiPageLoader {
  return async () => {
    const module = await load();
    const hosted = withAuthHost(module.default);
    hosted.displayName = displayName;
    return { default: hosted };
  };
}

export const authPageLoaders: UiPageLoaderRegistry = {
  "pages/auth/signin": frontDoorPage(authScreens.signin, "SignInPage"),
  "pages/auth/signup": frontDoorPage(authScreens.signup, "SignUpPage"),
  "pages/auth/forgot-password": frontDoorPage(
    authScreens.forgotPassword,
    "ForgotPasswordPage",
  ),
  "pages/auth/reset-password": frontDoorPage(
    authScreens.resetPassword,
    "ResetPasswordPage",
  ),
  "pages/auth/verify-email": frontDoorPage(authScreens.verifyEmail, "VerifyEmailPage"),
  "pages/auth/error": frontDoorPage(authScreens.signInError, "SignInErrorPage"),
  "pages/auth/join": frontDoorPage(authScreens.join, "JoinPage"),
  "pages/invite/accept": frontDoorPage(authScreens.inviteAccept, "InviteAcceptPage"),
};
