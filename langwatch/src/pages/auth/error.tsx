import {
  Alert,
  Button,
  Card,
  Container,
  Heading,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import Link from "~/utils/compat/next-link";
import { useSearchParams } from "~/utils/compat/next-navigation";
import { useSession } from "~/utils/auth-client";
import { useEffect } from "react";
import { LogoIcon } from "../../components/icons/LogoIcon";
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

/** Server route that clears BOTH the app session and the Auth0 session. */
export const FEDERATED_LOGOUT_PATH = "/api/auth/logout";

/** Friendly heading for known error codes; falls back to the raw code. */
const errorTitle = (error: string): string => {
  switch (error) {
    case "OAuthAccountNotLinked":
      return "Account already exists";
    case "DIFFERENT_EMAIL_NOT_ALLOWED":
      return "Can't link this account";
    case "SSO_PROVIDER_NOT_ALLOWED":
      return "Use your organization's sign-in";
    default:
      return error;
  }
};

export default function Error() {
  const { data: session } = useSession();
  const query = useSearchParams();
  const error = normalizeErrorCode(query?.get("error"));
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

    setTimeout(() => {
      if (typeof window !== "undefined" && typeof document !== "undefined") {
        if (isAuth0) {
          const referrer = document.referrer;
          // Check if referrer is from our own domain
          const isValidDomain = referrer?.startsWith(window.location.origin);
          if (isValidDomain) {
            window.location.href = referrer;
          } else {
            window.location.href = "/";
          }
        } else if (isAzureAD) {
          window.location.href = "/auth/signin";
        } else {
          window.location.href = "/auth/signin";
        }
      }
    }, 5000);
  }, [publicEnv.data, isAuth0, isAzureAD, session, error]);

  if (error) {
    return <SignInError error={error} />;
  }

  return (
    <div style={{ padding: "12px" }}>
      Auth Error: Redirecting back to Sign in... Click <a href="/">here</a> if
      you are not redirected within 5 seconds.
    </div>
  );
}

export function SignInError({ error: rawError }: { error: string }) {
  const query = useSearchParams();
  const callbackUrl = query?.get("callbackUrl") ?? undefined;
  const error = normalizeErrorCode(rawError) ?? rawError;

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
          <Alert.Root
            status={error === "OAuthAccountNotLinked" ? "warning" : "error"}
          >
            <Alert.Indicator />
            <Alert.Content gap={4}>
              <Alert.Title fontWeight="bold">{errorTitle(error)}</Alert.Title>
              {error === "OAuthAccountNotLinked" ? (
                <Alert.Description>
                  <VStack gap={1} align="start">
                    <Text>
                      This email is already registered with a different sign-in
                      method. To get back in, sign out completely and sign in
                      again using the method you used originally.
                      <br />
                      <br />
                      If your organization uses single sign-on, enter your work
                      email and choose your company login. You can link extra
                      sign-in methods later from{" "}
                      <b>Settings &gt; Authentication</b> once you are signed
                      in.
                    </Text>
                    <Button asChild marginTop={4} color="white">
                      <a href={FEDERATED_LOGOUT_PATH}>
                        Sign out &amp; try again
                      </a>
                    </Button>
                  </VStack>
                </Alert.Description>
              ) : error === "DIFFERENT_EMAIL_NOT_ALLOWED" ? (
                <Alert.Description>
                  <VStack gap={1} align="start">
                    <Text>
                      You cannot link an account with a different email address.
                      Please use the same email address as your current account.
                    </Text>
                    <Button asChild marginTop={4} color="white">
                      <Link href="/settings/authentication">
                        Back to Settings
                      </Link>
                    </Button>
                  </VStack>
                </Alert.Description>
              ) : error === "SSO_PROVIDER_NOT_ALLOWED" ? (
                <Alert.Description>
                  <VStack gap={1} align="start">
                    <Text>
                      Your organization requires single sign-on. Sign out and
                      sign in again by entering your company email address, then
                      choose your organization's login.
                    </Text>
                    <Button asChild marginTop={4} color="white">
                      <a href={FEDERATED_LOGOUT_PATH}>
                        Sign out &amp; try again
                      </a>
                    </Button>
                  </VStack>
                </Alert.Description>
              ) : (
                <Alert.Description>
                  Redirecting back to sign in, please try again...
                  <br />
                  <Button asChild marginTop={4} color="white">
                    <Link
                      href={`/auth/signin${
                        callbackUrl
                          ? `?callbackUrl=${encodeURIComponent(callbackUrl)}`
                          : ""
                      }`}
                    >
                      Try Sign In Again
                    </Link>
                  </Button>
                </Alert.Description>
              )}
            </Alert.Content>
          </Alert.Root>
        </Card.Body>
      </Card.Root>
    </Container>
  );
}
