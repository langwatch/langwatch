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
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Session } from "~/server/auth";
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
  if (error === "account_already_linked_to_different_user") {
    return "OAuthAccountNotLinked";
  }
  return error;
};

export default function Error({ session }: { session: Session | null }) {
  const query = useSearchParams();
  const error = normalizeErrorCode(query?.get("error"));
  const publicEnv = usePublicEnv();
  const isAuth0 = publicEnv.data?.NEXTAUTH_PROVIDER === "auth0";
  const isAzureAD = publicEnv.data?.NEXTAUTH_PROVIDER === "azure-ad";
  useEffect(() => {
    if (!publicEnv.data) {
      return;
    }

    if (
      error &&
      [
        "DIFFERENT_EMAIL_NOT_ALLOWED",
        "OAuthAccountNotLinked",
        "SSO_PROVIDER_NOT_ALLOWED",
      ].includes(error)
    ) {
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
              <Alert.Title fontWeight="bold">
                {error === "OAuthAccountNotLinked"
                  ? "Account already exists"
                  : error}
              </Alert.Title>
              {error === "OAuthAccountNotLinked" ? (
                <Alert.Description>
                  <VStack gap={1} align="start">
                    <Text>
                      An account with this email already exists but was created
                      with a different sign-in method (e.g. Google, GitHub).
                      <br />
                      <br />
                      To link this method, sign in with the method you used
                      originally, then go to{" "}
                      <b>Settings &gt; Authentication</b> to link additional
                      sign-in methods.
                    </Text>
                    <Button asChild marginTop={4} color="white">
                      <Link href="/auth/signin">
                        Sign in with another method
                      </Link>
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
                      Your organization requires SSO login. Please go back
                      and sign in by entering your company email address in
                      the login form.
                    </Text>
                    <Button asChild marginTop={4} color="white">
                      <Link href="/">Back to Login</Link>
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
