import { isStableAuthError, normalizeSignInErrorCode } from "@langwatch/auth-contract";
import { Link } from "@langwatch/browser-host/link";
import { Button, HStack, Spinner, Text, VStack } from "@langwatch/design-system/primitives";
import { explainHandledError } from "@langwatch/handled-error/presentation";
import { useEffect, useState } from "react";

import { isSameOrigin, signIn, useSession } from "../../behavior/auth-client.tsx";
import { hardNavigate } from "../../behavior/browser-navigation.ts";
import { usePublicEnv } from "../../behavior/use-public-env.ts";
import { useSearchParams } from "../../behavior/use-route.ts";
import {
  bounceConnectionFrom,
  cutoverSignInRefusal,
  governingConnectionFrom,
} from "../../model/sign-in-error-code.ts";
import { AuthCard } from "../elements/auth-card.tsx";
import { FrontDoorLinkButton } from "../elements/front-door-link-button.tsx";
import { FRONT_DOOR_PRIMARY_STYLE } from "../elements/front-door-primary-button.tsx";
import { FrontDoorShell } from "./front-door-shell.tsx";

/**
 * Server route that clears the app session and, on Auth0 deployments, federates to Auth0
 * `/v2/logout` to clear the identity-provider session too (see logoutHandler in
 * server/routes/auth.ts). Other providers just clear the app session and return to sign-in.
 */
export const FEDERATED_LOGOUT_PATH = "/api/auth/logout";

/**
 * The registry's words for a code the boundary admits, when it holds any. Gated on the admitted
 * set, not the registry alone: `?error=` is caller-controlled, so any code could otherwise pull
 * one of our sentences under a LangWatch heading.
 */
function admittedCopyFor(code: string): { title: string; description: string } | undefined {
  if (!isStableAuthError(code)) return undefined;
  const explained = explainHandledError({
    code,
    meta: {},
    httpStatus: 400,
    fault: "customer",
    retryable: false,
    tips: [],
    docsUrl: undefined,
    traceId: undefined,
    reasons: [],
  });
  if (!explained.isRegistered || !explained.description) return undefined;
  return { title: explained.title, description: explained.description };
}

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
    case "SSO_REQUIRED_BY_ORGANIZATION":
      return "Use your organization's sign-in";
    case "LINK_NEEDS_APPROVAL":
      return "This sign-in method needs approval";
    default:
      return (
        cutoverSignInRefusal(error)?.title ??
        admittedCopyFor(error)?.title ??
        "Something went wrong signing you in"
      );
  }
};

export default function Error() {
  return (
    <FrontDoorShell>
      <SignInErrorScreen />
    </FrontDoorShell>
  );
}

/**
 * Dials the connection the refusal named, answering it while the dial is live and null once the
 * server refused or the dial threw: a refused dial falls through to the stable refusal copy
 * instead of a card waiting on a provider that never answers (native-social-at-a-claimed-domain).
 */
function useConnectionBounce({
  error,
  target,
}: {
  error: ReturnType<typeof normalizeSignInErrorCode>;
  target: string | null | undefined;
}): string | null {
  const connectionId = bounceConnectionFrom({ error, target });
  const [dialRefused, setDialRefused] = useState(false);

  // Ahead of the five-second timer: this is somebody being taken to the door their
  // organization chose.
  useEffect(() => {
    if (!connectionId) return;
    let cancelled = false;
    void signIn(connectionId, { callbackUrl: "/" })
      .then((result) => {
        if (!cancelled && result?.error) setDialRefused(true);
      })
      .catch(() => {
        if (!cancelled) setDialRefused(true);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  return dialRefused ? null : connectionId;
}

export function SignInErrorScreen() {
  const { data: session } = useSession();
  const query = useSearchParams();
  const error = normalizeSignInErrorCode(query?.get("error"));
  const publicEnv = usePublicEnv();
  const isAuth0 = publicEnv.data?.NEXTAUTH_PROVIDER === "auth0";
  const isAzureAD = publicEnv.data?.NEXTAUTH_PROVIDER === "azure-ad";
  const bounceTo = useConnectionBounce({
    error,
    target: query?.get("error_description"),
  });

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

  if (bounceTo) {
    return (
      <AuthCard title="Taking you to your organization's sign-in">
        <HStack gap={3} justify="center">
          <Spinner size="sm" color="frontDoor.detail" />
          <Text color="fg.muted">One moment.</Text>
        </HStack>
      </AuthCard>
    );
  }

  if (error) {
    return <SignInError error={error} />;
  }

  // Reached with no error code to render: the effect above is already taking
  // them back to the front door. It is a wait rather than a failure, so it is
  // a card that says so — this branch used to be an unstyled line of text in
  // the corner of a blank page, sitting there for the full five seconds.
  return (
    <AuthCard title="Taking you back to sign in">
      <VStack width="full" align="stretch" gap={4}>
        <HStack gap={3} justify="center">
          <Spinner size="sm" color="frontDoor.detail" />
          <Text color="fg.muted">One moment.</Text>
        </HStack>
        <FrontDoorLinkButton href="/" label="Go to sign in" tone="secondary" />
      </VStack>
    </AuthCard>
  );
}

/** The card body for one sign-in error code: what happened, then the one way on. */
function SignInErrorDescription({
  error,
  callbackUrl,
  governingConnection,
}: {
  error: string;
  callbackUrl: string | undefined;
  governingConnection: string | null;
}) {
  if (governingConnection) {
    return (
      <VStack gap={4} align="stretch">
        <Text>
          An account with this email address already exists, and your organization requires its
          single sign-on for it. Sign in with your organization&apos;s single sign-on instead.
        </Text>
        <Button
          {...FRONT_DOOR_PRIMARY_STYLE}

          onClick={() => void signIn(governingConnection, { callbackUrl: callbackUrl ?? "/" })}
        >
          Continue with your organization&apos;s sign-in
        </Button>
        <FrontDoorLinkButton
          href={FEDERATED_LOGOUT_PATH}
          label="Sign out and try again"
          tone="secondary"
        />
      </VStack>
    );
  }

  if (error === "OAuthAccountNotLinked") {
    return (
      <VStack gap={4} align="stretch">
        <Text>
          This email already has an account. Sign in the way you did before, then connect this
          method in Settings &gt; Security.
        </Text>
        <Text fontSize="13px" color="fg.muted">
          If your organization uses single sign-on, enter your work email and choose your company
          login.
        </Text>
        <Button {...FRONT_DOOR_PRIMARY_STYLE} asChild>
          <a href={FEDERATED_LOGOUT_PATH}>Sign out and try again</a>
        </Button>
      </VStack>
    );
  }

  if (error === "DIFFERENT_EMAIL_NOT_ALLOWED") {
    return (
      <VStack gap={4} align="stretch">
        <Text>
          You cannot link an account with a different email address. Please use the same email
          address as your current account.
        </Text>
        <Button {...FRONT_DOOR_PRIMARY_STYLE} asChild>
          <Link href="/settings/authentication">Back to Settings</Link>
        </Button>
      </VStack>
    );
  }

  if (error === "SSO_PROVIDER_NOT_ALLOWED" || error === "SSO_REQUIRED_BY_ORGANIZATION") {
    return (
      <VStack gap={4} align="stretch">
        <Text>
          Your organization requires single sign-on. Sign out and sign in again by entering your
          company email address, then choose your organization's login.
        </Text>
        <Button {...FRONT_DOOR_PRIMARY_STYLE} asChild>
          <a href={FEDERATED_LOGOUT_PATH}>Sign out and try again</a>
        </Button>
      </VStack>
    );
  }

  if (error === "signed_in_as_another_user") {
    return (
      <VStack gap={4} align="stretch">
        <Text>
          You are already signed in as someone else. Sign out, then sign in again from your identity
          provider.
        </Text>
        <Button {...FRONT_DOOR_PRIMARY_STYLE} asChild>
          <a href={FEDERATED_LOGOUT_PATH}>Sign out</a>
        </Button>
      </VStack>
    );
  }

  if (error === "LINK_NEEDS_APPROVAL") {
    return (
      <VStack gap={4} align="stretch">
        <Text>
          We could not confirm that this login belongs to your LangWatch account, so it has not been
          added to it.
        </Text>
        <Text fontSize="13px" color="fg.muted">
          An administrator in your organization can review the request and approve it. In the
          meantime, sign in with a method you have used before.
        </Text>
        <Button {...FRONT_DOOR_PRIMARY_STYLE} asChild>
          <a href={FEDERATED_LOGOUT_PATH}>Sign out and try again</a>
        </Button>
      </VStack>
    );
  }

  const refusal = cutoverSignInRefusal(error);
  if (refusal) {
    return (
      <VStack gap={4} align="stretch">
        <Text>{refusal.body}</Text>
        <Button {...FRONT_DOOR_PRIMARY_STYLE} asChild>
          <Link href="/auth/signin">Back to sign in</Link>
        </Button>
      </VStack>
    );
  }

  // Every admitted refusal is stable: the provider still holds a live session, so sign out first.
  const admitted = admittedCopyFor(error);
  if (admitted) {
    return (
      <VStack gap={4} align="stretch">
        <Text>{admitted.description}</Text>
        <Button {...FRONT_DOOR_PRIMARY_STYLE} asChild>
          <a href={FEDERATED_LOGOUT_PATH}>Sign out and try again</a>
        </Button>
      </VStack>
    );
  }

  return (
    <VStack gap={4} align="stretch">
      <Text>Please try signing in again.</Text>
      <Button {...FRONT_DOOR_PRIMARY_STYLE} asChild>
        <Link
          href={`/auth/signin${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`}
        >
          Back to sign in
        </Link>
      </Button>
    </VStack>
  );
}

export function SignInError({ error: rawError }: { error: string }) {
  const query = useSearchParams();
  const callbackUrl = query?.get("callbackUrl") ?? undefined;
  const error = normalizeSignInErrorCode(rawError) ?? rawError;
  const governingConnection = governingConnectionFrom({
    error,
    target: query?.get("error_description"),
  });
  // The handle on a cause we deliberately did not name, so the person has something to quote.
  const trace = query?.get("trace") ?? null;

  return (
    <AuthCard title={errorTitle(error)}>
      <SignInErrorDescription
        error={error}
        callbackUrl={callbackUrl}
        governingConnection={governingConnection}
      />
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
    </AuthCard>
  );
}
