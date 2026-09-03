/**
 * Which page keys the front door answers, and what they are wrapped in. No
 * guard here, and none should be added: these are the addresses a signed-
 * out person reaches, so a permission gate would block the way in.
 */

import { authScreens } from "@langwatch/auth-web/screens/auth";
import type { ComponentType } from "react";

import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { AuthHost } from "./auth-host";

/** One screen, hosted, under the name a stack trace should show. */
function frontDoorPage(
  load: () => Promise<{ default: ComponentType }>,
  displayName: string,
): UiPageLoader {
  const loader = uiPage({ screen: load, host: AuthHost });
  return async () => {
    const result = await loader();
    result.default.displayName = displayName;
    return result;
  };
}

export const authPageLoaders: UiPageLoaderRegistry = {
  "pages/auth/signin": frontDoorPage(authScreens.signin, "SignInPage"),
  "pages/auth/signup": frontDoorPage(authScreens.signup, "SignUpPage"),
  "pages/auth/forgot-password": frontDoorPage(authScreens.forgotPassword, "ForgotPasswordPage"),
  "pages/auth/reset-password": frontDoorPage(authScreens.resetPassword, "ResetPasswordPage"),
  "pages/auth/verify-email": frontDoorPage(authScreens.verifyEmail, "VerifyEmailPage"),
  "pages/auth/error": frontDoorPage(authScreens.signInError, "SignInErrorPage"),
  "pages/auth/join": frontDoorPage(authScreens.join, "JoinPage"),
  "pages/invite/accept": frontDoorPage(authScreens.inviteAccept, "InviteAcceptPage"),
};
