/**
 * The procedures the front door calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as every other feature
 * family's map says of itself: the procedures are mounted by the process out of
 * `@langwatch/auth-server` and the platform's own routers, which a web package
 * may not import even for a type, and the router type does not exist until a
 * process instantiates one.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `frontDoor`, `organization`, `user` and
 * `publicEnv` are the mount points on the root router, and tRPC hashes that
 * path into the React Query cache key; spell one differently and these hooks
 * quietly stop sharing a cache with the `api.organization.*` call sites that
 * have NOT moved.
 *
 * THREE ROUTERS RATHER THAN ONE, and that is the family rather than a leak:
 * signing up writes a user (`user.register`) and accepting an invitation
 * writes a membership (`organization.acceptInvite`); both are the front door's
 * only reason to exist, and neither has a `frontDoor.*` twin to call instead.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package — the same exception every
 * family since governance has carried.
 */

import type { RoutingDecision } from "@langwatch/identity-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/**
 * The deployment facts only a request can answer.
 *
 * The STATIC half of the public environment arrives on the host port; this is
 * the half the server decides per viewer — which sign-in provider the
 * installation is configured for, and whether it can send mail at all.
 */
export type AuthViewerCapabilities = {
  NEXTAUTH_PROVIDER?: string | undefined;
  HAS_EMAIL_PROVIDER_KEY?: boolean;
  [capability: string]: unknown;
};

/** What an invitation link may say to whoever opens it. */
export type AuthInviteLanding = {
  organizationName: string;
  inviterName: string | null;
};

/** How verifying a sign-up address turned out. */
export type AuthVerificationResult = {
  email: string;
  accountCreated: boolean;
  accountExists: boolean;
};

/** What accepting an invitation hands back, as the landing reads it. */
export type AuthAcceptedInvite = {
  invite: { organization: { name: string } };
  project?: { slug: string } | null;
};

export type AuthApiMap = {
  frontDoor: {
    /** An address goes out, a routing decision comes back (ADR-117 §6). */
    route: {
      mutation: {
        input: { identifier: string | null; breakGlass?: boolean };
        output: RoutingDecision;
      };
    };
    /** Sends a sign-up address its confirmation link. Verification-first. */
    requestSignUpVerification: {
      mutation: { input: { email: string }; output: { sent: true } };
    };
    /** Sends the confirmation link for the caller's OWN address. */
    sendMyAddressConfirmation: {
      mutation: { input: Record<string, never>; output: { sent: true } };
    };
    /** Spends the emailed token and says what it made. */
    completeSignUpVerification: {
      mutation: { input: { token: string }; output: AuthVerificationResult };
    };
    /** Which organization is asking, and who asked. */
    inviteLanding: {
      query: { input: { inviteCode: string }; output: AuthInviteLanding };
    };
    /** "My invitation expired, send me another" (D11). Mints nothing. */
    requestFreshInvite: {
      mutation: { input: { inviteCode: string }; output: { asked: boolean } };
    };
  };
  organization: {
    /** Turns an invitation code into a membership. */
    acceptInvite: {
      mutation: { input: { inviteCode: string }; output: AuthAcceptedInvite };
    };
  };
  user: {
    /** Creates the account the credentials sign-up leg then signs in. */
    register: {
      mutation: {
        input: { email: string; password: string; name?: string; confirmPassword?: string };
        output: unknown;
      };
    };
  };
  /** The deployment facts that need a request to answer. Root-level. */
  publicEnv: { query: { input: Record<string, never>; output: AuthViewerCapabilities } };
};

/**
 * The front door's typed tRPC hooks. Same machinery, same transport and same
 * React Query cache as the application's `api` proxy — see `createFeatureApi`
 * for why separate instances still share cache entries.
 */
export const authApi = createFeatureApi<AuthApiMap>();
