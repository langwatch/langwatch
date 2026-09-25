/**
 * What a browser installs when it installs auth: the unauthenticated
 * front-door screens, every one under the auth layout that mounts AuthHostApi.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const authWeb = defineWebModule("auth")
  .withScreens({
    // Placed by the application's route table until a top-level anchor accepts
    // declared routes; the loader is this module's either way.
    "pages/auth/signin": {
      path: "/auth/signin",
      load: () => import("./ui/sections/signin-screen.tsx"),
    },
    "pages/auth/signup": {
      path: "/auth/signup",
      load: () => import("./ui/sections/signup-screen.tsx"),
    },
    "pages/auth/forgot-password": {
      path: "/auth/forgot-password",
      load: () => import("./ui/sections/forgot-password-screen.tsx"),
    },
    "pages/auth/reset-password": {
      path: "/auth/reset-password",
      load: () => import("./ui/sections/reset-password-screen.tsx"),
    },
    "pages/auth/verify-email": {
      path: "/auth/verify-email",
      load: () => import("./ui/sections/verify-email-screen.tsx"),
    },
    "pages/auth/error": {
      path: "/auth/error",
      load: () => import("./ui/sections/sign-in-error-screen.tsx"),
    },
    "pages/auth/join": {
      path: "/auth/join",
      load: () => import("./ui/sections/join-screen.tsx"),
    },
    "pages/auth/sso-test-complete": {
      path: "/auth/sso-test-complete",
      load: () => import("./ui/sections/sso-test-complete-screen.tsx"),
    },
    "pages/invite/accept": {
      path: "/invite/accept",
      load: () => import("./ui/sections/invite-accept-screen.tsx"),
    },
  })
  .withCapabilities({
    /** Auth's half of a peer's host: a sign-in that names a connection, and
     *  one spelling for a sign-in code. */
    signIn: { load: () => import("./behavior/sign-in-capability.ts") },
    /** The reader's own passkeys, for the personal workspace's security screen. */
    passkeys: { load: () => import("./behavior/passkey-capability.ts") },
    /** Setting two-step verification up, and fresh backup codes. */
    twoStepVerification: { load: () => import("./behavior/two-step-capability.ts") },
  });
