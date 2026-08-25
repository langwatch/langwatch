import { Box, Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { AuthCard } from "~/components/auth/AuthCard";
import {
  AuthShell,
  useIdentityAuthScreens,
} from "~/features/auth";
import { AUTH_PRIMARY_STYLE } from "~/features/auth/components/AuthPrimaryButton";
import { SHAPE } from "~/features/auth/authTheme";
import { usePublishAuthStage } from "~/features/auth/logic/groundStage";
import { isSameOrigin, useSession } from "~/utils/auth-client";
import { hardNavigate } from "~/utils/browserNavigation";
import Link from "~/utils/compat/next-link";
import { useSearchParams } from "~/utils/compat/next-navigation";
import { usePublicEnv } from "../../hooks/usePublicEnv";

/**
 * BetterAuth emits granular low-level error codes (e.g. `email_doesn't_match`,
 * `LINKING_DIFFERENT_EMAILS_NOT_ALLOWED`) from the link-account flow. Map
 * them back to the friendly uppercase codes this UI already handles, so
 * the same error page works for both the NextAuth-era codes we throw from
 * hooks and the BetterAuth-native ones coming out of the OAuth callback.
 *
 * Exported for unit testing.
 */
export const normalizeErrorCode = (
  error: string | null | undefined,
): string | null => {
  if (!error) return null;
  if (
    error === "email_doesn't_match" ||
    error === "LINKING_DIFFERENT_EMAILS_NOT_ALLOWED"
  ) {
    return "DIFFERENT_EMAIL_NOT_ALLOWED";
  }
  if (
    error === "account_already_linked_to_different_user" ||
    error === "account_not_linked" ||
    error === "OAuthAccountNotLinked"
  ) {
    return "OAuthAccountNotLinked";
  }
  return error;
};

/**
 * Auth errors that represent a *stable* failure the user has to act on (wrong
 * sign-in method / account collision), not a transient glitch we can silently
 * retry. For these we must NOT auto-redirect back to the identity provider:
 * the IdP still holds a live session for the failing identity, so bouncing
 * straight back silently re-authenticates the same identity and traps the user
 * in a loop (the exact symptom behind the "stuck in the sign-in loop" report).
 * Recovery instead goes through a federated logout so the IdP session is
 * cleared first and the next attempt lets them pick a different method.
 *
 * Shared between this page and the sign-in page so the two auto-redirect gates
 * can never drift apart.
 */
export const STABLE_AUTH_ERRORS = [
  "OAuthAccountNotLinked",
  "DIFFERENT_EMAIL_NOT_ALLOWED",
  "SSO_PROVIDER_NOT_ALLOWED",
] as const;

export const isStableAuthError = (error: string | null | undefined): boolean =>
  !!error && (STABLE_AUTH_ERRORS as readonly string[]).includes(error);

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
const errorTitle = (error: string): string => {
  switch (error) {
    case "OAuthAccountNotLinked":
      return "Account already exists";
    case "DIFFERENT_EMAIL_NOT_ALLOWED":
      return "Can't link this account";
    case "SSO_PROVIDER_NOT_ALLOWED":
      return "Use your organization's sign-in";
    default:
      return "Something went wrong signing you in";
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
  const auth = useIdentityAuthScreens();

  if (!auth.isResolved) return null;
  return auth.enabled ? (
    <AuthShell>
      <SignInErrorScreen />
    </AuthShell>
  ) : (
    <SignInErrorScreen />
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

  return (
    <AuthCard title={errorTitle(error)}>
      <VStack width="full" align="stretch" gap="14px">
        {prose.map((paragraph) => (
          <ErrorProse key={paragraph}>{paragraph}</ErrorProse>
        ))}
        <RecoveryAction href={action.href} internal={action.internal}>
          {action.label}
        </RecoveryAction>
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
      return {
        prose: [
          "Your organization requires single sign-on. Sign out and sign in again by entering your company email address, then choose your organization's login.",
        ],
        action: signOutAndRetry,
      };
    default:
      return {
        prose: ["Redirecting back to sign in, please try again..."],
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
