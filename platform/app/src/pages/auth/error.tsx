import { Box, Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { looksLikeSsoConnectionId } from "@langwatch/identity";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { AuthCard } from "~/components/auth/AuthCard";
import { AuthShell } from "~/features/auth";
import { AUTH_PRIMARY_STYLE } from "~/features/auth/components/AuthPrimaryButton";
import { usePublishAuthStage } from "~/features/auth/logic/groundStage";
import {
  isStableAuthError,
  normalizeErrorCode,
} from "~/features/auth/logic/signInErrorCodes";
import { explainHandledError } from "~/features/errors/logic/presentation";
import { isSameOrigin, signIn, useSession } from "~/utils/auth-client";
import { hardNavigate } from "~/utils/browserNavigation";
import Link from "~/utils/compat/next-link";
import { useSearchParams } from "~/utils/compat/next-navigation";
import { usePublicEnv } from "../../hooks/usePublicEnv";

/*
 * `normalizeErrorCode`, `STABLE_AUTH_ERRORS` and `isStableAuthError` moved to
 * `~/features/auth/logic/signInErrorCodes` when the redirect boundary
 * (specs/identity/sso-signin-error-boundary.feature) started needing them on
 * the SERVER: the list of codes a screen has words for is the same list that
 * decides which codes may travel in the address bar, and two copies of it
 * would drift into a code that crosses with nothing to say about it. This
 * page is a consumer of that list now, not its home.
 */

/**
 * A refusal that is a BOUNCE: somebody pressed a native social button, and
 * their organization signs its people in through its own connection.
 *
 * The connection is what made the refusal, so the refusal carries it — the
 * hook throws it as the `APIError` message and better-auth puts the message in
 * `error_description` on the callback redirect. This page is where it is spent.
 *
 * READ AS AN IDENTIFIER, NEVER AS AN ADDRESS. The parameter arrives over the
 * wire, which means anybody can write one; a page that navigated to whatever
 * it found there would be an open redirect reachable from a bare URL. So the
 * value only ever reaches `signIn`, which builds the address itself, and only
 * once it is shaped like a connection id. Anything else is not followed, and
 * the ordinary refusal copy is what shows instead.
 */
export const SSO_BOUNCE_ERROR = "SSO_REQUIRED_BY_ORGANIZATION";

export const bounceConnectionFrom = (
  error: string | null | undefined,
  target: string | null | undefined,
): string | null => {
  if (error !== SSO_BOUNCE_ERROR) return null;
  if (!target || !looksLikeSsoConnectionId(target)) return null;
  return target;
};

/**
 * Server route that clears the app session and, on Auth0 deployments,
 * federates to Auth0 `/v2/logout` to clear the identity-provider session too
 * (see logoutHandler in server/routes/auth.ts). Other providers just clear the
 * app session and return to sign-in.
 */
export const FEDERATED_LOGOUT_PATH = "/api/auth/logout";

/**
 * Friendly heading for known error codes. An unknown code gets generic copy,
 * never itself: `?error=` is caller-controlled, and echoing it made this
 * heading a place to put attacker-chosen words under LangWatch branding.
 */
/**
 * The words the presentation registry already holds for a code, when it holds
 * any and when the code is one we admit.
 *
 * THE FIVE ASSERTION REFUSALS WERE CROSSING ON A PROMISE NOBODY KEPT.
 * `signInErrorCodes.ts` admits `sso_sign_in_refused`,
 * `sso_assertion_without_address`, `sso_setup_address_mismatch`,
 * `sso_domain_not_verified` and `sso_domain_proof_lapsed` across the redirect
 * boundary on the grounds that they are "codes a screen has written words
 * for" — and every one of them fell through this file's default arm and read
 * "Something went wrong signing you in". The words existed the whole time, in
 * the registry, written with care; this page simply never looked.
 *
 * GATED ON THE ADMITTED SET, not on the registry alone. `?error=` is
 * caller-controlled, so consulting the registry for ANY code would let
 * somebody pick whichever of our sentences suited them and show it under a
 * LangWatch heading. The codes the server boundary is willing to let travel
 * are exactly the codes this page is willing to read copy for, which keeps
 * one list in charge of both halves.
 */
function admittedCopyFor(
  code: string,
): { title: string; description: string } | null {
  if (!isStableAuthError(code)) return null;
  const explained = explainHandledError({
    code,
    meta: {},
    httpStatus: 400,
    fault: "customer",
    tips: [],
    docsUrl: undefined,
    traceId: undefined,
    reasons: [],
  });
  // `isRegistered` is false for the humanised-code fallback, which is the
  // degraded form and no better than the generic line below it.
  if (!explained.isRegistered || !explained.description) return null;
  return { title: explained.title, description: explained.description };
}

const errorTitle = (error: string): string => {
  switch (error) {
    case "OAuthAccountNotLinked":
      return "Account already exists";
    case "DIFFERENT_EMAIL_NOT_ALLOWED":
      return "Can't link this account";
    case "SSO_PROVIDER_NOT_ALLOWED":
    case "SSO_REQUIRED_BY_ORGANIZATION":
      return "Use your organization's sign-in";
    case "LINK_NEEDS_APPROVAL":
      return "This sign-in method needs approval";
    default:
      return (
        admittedCopyFor(error)?.title ?? "Something went wrong signing you in"
      );
  }
};

/**
 * The sign-in error landing (D13, ADR-117 §7).
 *
 * The card is the auth screens' on every installation; what the flag decides is
 * whether the auth screens' GROUND is under it, exactly as the reset pair
 * compose it. Somebody arriving here has just been thrown out of a sign-in,
 * and the page they land on should be recognisably the page they were on.
 */
export default function Error() {
  return (
    <AuthShell>
      <SignInErrorScreen />
    </AuthShell>
  );
}

function SignInErrorScreen() {
  const { data: session } = useSession();
  const query = useSearchParams();
  const error = normalizeErrorCode(query?.get("error"));
  const publicEnv = usePublicEnv();
  usePublishAuthStage({ door: "signin", depth: "entry" });
  const isAuth0 = publicEnv.data?.NEXTAUTH_PROVIDER === "auth0";
  const isAzureAD = publicEnv.data?.NEXTAUTH_PROVIDER === "azure-ad";
  const bounceTo = bounceConnectionFrom(error, query?.get("error_description"));

  // The bounce, ahead of every other effect on this page and not waiting on
  // the five-second timer: this is not somebody being told why they failed, it
  // is somebody being taken to the door their organization chose. They should
  // see their own provider, not a page about Google.
  useEffect(() => {
    if (!bounceTo) return;
    void signIn(bounceTo, { callbackUrl: "/" });
  }, [bounceTo]);

  useEffect(() => {
    if (!publicEnv.data) {
      return;
    }

    if (isStableAuthError(error)) {
      return;
    }

    const redirectTimeout = setTimeout(() => {
      if (typeof window !== "undefined" && typeof document !== "undefined") {
        if (isAuth0) {
          const referrer = document.referrer;
          const isValidDomain = !!referrer && isSameOrigin(referrer);
          if (isValidDomain) {
            hardNavigate(referrer);
          } else {
            hardNavigate("/");
          }
        } else if (isAzureAD) {
          hardNavigate("/auth/signin");
        } else {
          hardNavigate("/auth/signin");
        }
      }
    }, 5000);

    return () => clearTimeout(redirectTimeout);
  }, [publicEnv.data, isAuth0, isAzureAD, session, error]);

  // Not an error card: they are on their way somewhere, and the card says
  // where. A page headed "something went wrong" about a redirect that is
  // working would be the third wrong answer this refusal has had.
  if (bounceTo) {
    return (
      <AuthCard title="Taking you to your organization's sign-in">
        <HStack gap={3}>
          <Spinner size="sm" color="auth.detail" />
          <Text color="fg.muted">One moment.</Text>
        </HStack>
      </AuthCard>
    );
  }

  if (error) {
    return <SignInError error={error} />;
  }

  // Reached with no error code to render: the effect above is already taking
  // them back to the auth screens. It is a wait rather than a failure, so it is
  // a card that says so — this branch used to be an unstyled line of text in
  // the corner of a blank page, sitting there for the full five seconds.
  return (
    <AuthCard title="Taking you back to sign in">
      <VStack width="full" align="stretch" gap={4}>
        <HStack gap={3}>
          <Spinner size="sm" color="auth.detail" />
          <Text color="fg.muted">One moment.</Text>
        </HStack>
        <Text fontSize="13px" color="fg.muted">
          If nothing happens,{" "}
          <Box
            asChild
            color="fg"
            fontWeight={600}
            textDecoration="underline"
            textUnderlineOffset="3px"
          >
            <a href="/auth/signin">go to sign in</a>
          </Box>
          .
        </Text>
      </VStack>
    </AuthCard>
  );
}

/**
 * A sign-in that failed for a reason the person has to act on, said on the
 * auth screens's own card (D13, ADR-117 §7).
 *
 * It used to be the app's settings furniture — a bordered panel, a logo beside
 * a title-cased "Sign in Error", the whole message inside a red alert — and it
 * is rendered from INSIDE the new sign-in screen, which made the one moment
 * somebody is most likely to wonder whether they are still on the same site
 * the moment the site changed shape under them. The heading now says what
 * happened instead of naming the category of thing that happened, which is
 * what the alert title was already doing one line further down.
 *
 * Every word and every destination survives unchanged, because those are the
 * behaviour rather than the paint: the recovery for an account collision is
 * still a federated logout rather than a bounce back to the door (the "stuck
 * in the sign-in loop" report), and an unknown code still gets generic copy
 * rather than itself.
 *
 * These codes are the identity provider's and the OAuth callback's, not the
 * handled-error contract's, so their words live in `errorTitle` and the
 * branches below rather than in the code-keyed registry. Nothing here renders
 * `?error=` itself: it is caller-controlled, and echoing it would put
 * attacker-chosen words under a LangWatch heading.
 */
export function SignInError({ error: rawError }: { error: string }) {
  const query = useSearchParams();
  const callbackUrl = query?.get("callbackUrl") ?? undefined;
  const error = normalizeErrorCode(rawError) ?? rawError;
  const { prose, action } = recoveryFor({ error, callbackUrl });
  // The handle on a cause we deliberately did not name. The boundary puts it
  // here precisely because the reason itself is withheld — without it the
  // person has nothing to quote and support has nothing to look up, which is
  // what the old habit of pasting the whole URL was really for.
  const trace = query?.get("trace") ?? null;

  return (
    <AuthCard title={errorTitle(error)}>
      <VStack width="full" align="stretch" gap="14px">
        {prose.map((paragraph) => (
          <ErrorProse key={paragraph}>{paragraph}</ErrorProse>
        ))}
        <RecoveryAction href={action.href} internal={action.internal}>
          {action.label}
        </RecoveryAction>
        {trace && (
          <Text
            fontSize="11.5px"
            color="fg.subtle"
            fontFamily="mono"
            data-testid="sign-in-error-trace"
          >
            Reference: {trace}
          </Text>
        )}
      </VStack>
    </AuthCard>
  );
}

/** What a code says, and the one thing to do about it. */
interface Recovery {
  prose: readonly string[];
  action: { href: string; internal: boolean; label: string };
}

/**
 * The words and the way out for one code, as a table rather than a chain of
 * conditions.
 *
 * A table because every branch here answers the same two questions, and a
 * ladder of ternaries in the middle of the markup made that impossible to see
 * — and impossible to check that each arm actually has a way out. Every entry
 * has an action, because a refusal without one is a dead end with an
 * explanation attached.
 *
 * The default arm is the important one: `?error=` is caller-controlled, so a
 * code we do not recognise gets generic copy and the door back, never its own
 * text under a LangWatch heading.
 */
function recoveryFor({
  error,
  callbackUrl,
}: {
  error: string;
  callbackUrl?: string;
}): Recovery {
  // Clearing the identity provider's session as well as ours, so the next
  // attempt can pick a different method instead of being silently re-authed
  // as the identity that just failed.
  const signOutAndRetry = {
    href: FEDERATED_LOGOUT_PATH,
    internal: false,
    label: "Sign out & try again",
  };

  switch (error) {
    case "OAuthAccountNotLinked":
      return {
        prose: [
          "This email is already registered with a different sign-in method. To get back in, sign out completely and sign in again using the method you used originally.",
          "If your organization uses single sign-on, enter your work email and choose your company login.",
        ],
        action: signOutAndRetry,
      };
    case "DIFFERENT_EMAIL_NOT_ALLOWED":
      return {
        prose: [
          "You cannot link an account with a different email address. Please use the same email address as your current account.",
        ],
        // The one code that arrives from a SIGNED-IN journey: somebody linking
        // a second account in settings. Sending them through a logout would
        // throw away the session they were using.
        action: {
          href: "/settings/security",
          internal: true,
          label: "Back to Settings",
        },
      };
    case "SSO_PROVIDER_NOT_ALLOWED":
    case "SSO_REQUIRED_BY_ORGANIZATION":
      return {
        prose: [
          "Your organization requires single sign-on. Sign out and sign in again by entering your company email address, then choose your organization's login.",
        ],
        action: signOutAndRetry,
      };
    case "LINK_NEEDS_APPROVAL":
      return {
        prose: [
          "We could not confirm that this login belongs to your LangWatch account, so it has not been added to it.",
          "An administrator in your organization can review the request and approve it. In the meantime, sign in with a method you have used before.",
        ],
        action: signOutAndRetry,
      };
    default: {
      // The refusals the boundary admits, in the words already written for
      // them. Reached only for a code `isStableAuthError` allows, so the
      // sentence is one of ours; the way out is the federated logout, because
      // every one of these is stable in the sense that matters here — the
      // identity provider still holds a live session, so pressing the same
      // button re-authenticates the same identity and is refused the same
      // way.
      const admitted = admittedCopyFor(error);
      if (admitted) {
        return { prose: [admitted.description], action: signOutAndRetry };
      }
      return {
        // NAMES THE BUTTON, not a redirect. `SignInError` is rendered from
        // inside the identifier-first screen for any unrecognised
        // `?error=`, and that screen mounts no timer — the five-second one
        // lives in `SignInErrorScreen` and the two-second one in
        // `LegacySignIn`, neither of which is on this path. Promising a
        // redirect left people waiting for something that was never coming.
        prose: ["Something went wrong signing you in. Try again below."],
        action: {
          href: `/auth/signin${
            callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""
          }`,
          internal: true,
          label: "Try Sign In Again",
        },
      };
    }
  }
}

/** The card's reading voice: the size and line height every screen here sets. */
function ErrorProse({ children }: { children: ReactNode }) {
  return (
    <Text fontSize="13.5px" lineHeight="1.65" color="fg.muted">
      {children}
    </Text>
  );
}

/**
 * The one thing to do about it, drawn as the card's primary action.
 *
 * The federated-logout destination is a SERVER route that clears the identity
 * provider's session as well as ours, so it has to leave the single-page app
 * rather than be routed inside it — hence the plain anchor, and hence
 * `internal` being something a caller states rather than something guessed
 * from the shape of the path.
 */
function RecoveryAction({
  href,
  internal = false,
  children,
}: {
  href: string;
  /** Whether the destination is a page this app draws. */
  internal?: boolean;
  children: ReactNode;
}) {
  return (
    <Button {...AUTH_PRIMARY_STYLE} asChild>
      {internal ? (
        <Link href={href}>{children}</Link>
      ) : (
        <a href={href}>{children}</a>
      )}
    </Button>
  );
}
