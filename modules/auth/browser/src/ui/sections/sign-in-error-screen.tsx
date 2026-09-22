import { Alert, Button, Card, Container, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { useEffect } from "react";

import { isSameOrigin, useSession } from "../../behavior/auth-client.tsx";
import { hardNavigate } from "../../behavior/browser-navigation.ts";
import { usePublicEnv } from "../../behavior/use-public-env.ts";
import { useSearchParams } from "../../behavior/use-route.ts";
import {
  CUTOVER_SIGN_IN_ERRORS,
  cutoverSignInRefusal,
  normalizeSignInErrorCode,
} from "../../model/sign-in-error-code.ts";
import { LogoIcon } from "../../ui/elements/logo-icon.tsx";
import Link from "../../ui/elements/router-link.tsx";

/**
 * Auth errors that represent a *stable* failure the user has to act on (wrong sign-in method /
 * account collision), not a transient glitch we can silently retry.
 */
export const STABLE_AUTH_ERRORS = [
  "OAuthAccountNotLinked",
  "DIFFERENT_EMAIL_NOT_ALLOWED",
  "SSO_PROVIDER_NOT_ALLOWED",
  // A refusal the organization's move decided: sending them back to the same
  // button five seconds later would loop them through it.
  ...Object.keys(CUTOVER_SIGN_IN_ERRORS),
] as const;

export const isStableAuthError = (error: string | null | undefined): boolean =>
  !!error && (STABLE_AUTH_ERRORS as readonly string[]).includes(error);

/**
 * Server route that clears the app session and, on Auth0 deployments, federates to Auth0
 * `/v2/logout` to clear the identity-provider session too (see logoutHandler in
 * server/routes/auth.ts). Other providers just clear the app session and return to sign-in.
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
      return cutoverSignInRefusal(error)?.title ?? "Something went wrong signing you in";
  }
};

export default function Error() {
  const { data: session } = useSession();
  const query = useSearchParams();
  const error = normalizeSignInErrorCode(query?.get("error"));
  const publicEnv = usePublicEnv();
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
  // them back to the front door. It is a wait rather than a failure, so it is
  // a card that says so — this branch used to be an unstyled line of text in
  // the corner of a blank page, sitting there for the full five seconds.
  return (
    <div style={{ padding: "12px" }}>
      Auth Error: Redirecting back to Sign in... Click <a href="/">here</a> if you are not
      redirected within 5 seconds.
    </div>
  );
}

/** The alert body for one sign-in error code. */
function SignInErrorDescription({
  error,
  callbackUrl,
}: {
  error: string;
  callbackUrl: string | undefined;
}) {
  if (error === "OAuthAccountNotLinked") {
    return (
      <Alert.Description>
        <VStack gap={1} align="start">
          <Text>
            This email is already registered with a different sign-in method. To get back in, sign
            out completely and sign in again using the method you used originally.
            <br />
            <br />
            If your organization uses single sign-on, enter your work email and choose your company
            login.
          </Text>
          <Button asChild marginTop={4} color="white">
            <a href={FEDERATED_LOGOUT_PATH}>Sign out &amp; try again</a>
          </Button>
        </VStack>
      </Alert.Description>
    );
  }

  if (error === "DIFFERENT_EMAIL_NOT_ALLOWED") {
    return (
      <Alert.Description>
        <VStack gap={1} align="start">
          <Text>
            You cannot link an account with a different email address. Please use the same email
            address as your current account.
          </Text>
          <Button asChild marginTop={4} color="white">
            <Link href="/settings/authentication">Back to Settings</Link>
          </Button>
        </VStack>
      </Alert.Description>
    );
  }

  if (error === "SSO_PROVIDER_NOT_ALLOWED") {
    return (
      <Alert.Description>
        <VStack gap={1} align="start">
          <Text>
            Your organization requires single sign-on. Sign out and sign in again by entering your
            company email address, then choose your organization's login.
          </Text>
          <Button asChild marginTop={4} color="white">
            <a href={FEDERATED_LOGOUT_PATH}>Sign out &amp; try again</a>
          </Button>
        </VStack>
      </Alert.Description>
    );
  }

  const refusal = cutoverSignInRefusal(error);
  if (refusal) {
    return (
      <Alert.Description>
        <VStack gap={1} align="start">
          <Text>{refusal.body}</Text>
          <Button asChild marginTop={4} color="white">
            <Link href="/auth/signin">Back to sign in</Link>
          </Button>
        </VStack>
      </Alert.Description>
    );
  }

  return (
    <Alert.Description>
      Redirecting back to sign in, please try again...
      <br />
      <Button asChild marginTop={4} color="white">
        <Link
          href={`/auth/signin${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`}
        >
          Try Sign In Again
        </Link>
      </Button>
    </Alert.Description>
  );
}

export function SignInError({ error: rawError }: { error: string }) {
  const query = useSearchParams();
  const callbackUrl = query?.get("callbackUrl") ?? undefined;
  const error = normalizeSignInErrorCode(rawError) ?? rawError;

  return (
    <Container maxW="container.md" paddingTop="calc(40vh - 164px)">
      <Card.Root>
        <Card.Header>
          <HStack gap={4}>
            <LogoIcon width={30.69} height={42} />
            <Heading size="lg" as="h1">
              Sign in Error
            </Heading>
          </HStack>
        </Card.Header>
        <Card.Body>
          <Alert.Root status={error === "OAuthAccountNotLinked" ? "warning" : "error"}>
            <Alert.Indicator />
            <Alert.Content gap={4}>
              <Alert.Title fontWeight="bold">{errorTitle(error)}</Alert.Title>
              <SignInErrorDescription error={error} callbackUrl={callbackUrl} />
            </Alert.Content>
          </Alert.Root>
        </Card.Body>
      </Card.Root>
    </Container>
  );
}
