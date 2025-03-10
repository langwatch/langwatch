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
import { type Session } from "next-auth";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { LogoIcon } from "../../components/icons/LogoIcon";
import { usePublicEnv } from "../../hooks/usePublicEnv";

export default function Error({ session }: { session: Session | null }) {
  const query = useSearchParams();
  const error = query?.get("error");
  const publicEnv = usePublicEnv();
  const isAuth0 = publicEnv.data?.NEXTAUTH_PROVIDER === "auth0";

  useEffect(() => {
    if (!publicEnv.data) {
      return;
    }

    if (error && ["DIFFERENT_EMAIL_NOT_ALLOWED", "OAuthAccountNotLinked"].includes(error)) {
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
        } else {
          window.location.href = "/auth/signin";
        }
      }
    }, 5000);
  }, [publicEnv.data, isAuth0, session, error]);

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

export function SignInError({ error }: { error: string }) {
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
              <Alert.Title fontWeight="bold">{error}</Alert.Title>
              {error === "OAuthAccountNotLinked" ? (
                <Alert.Description>
                  <VStack gap={1} align="start">
                    <Text>
                      It might be that an account using this email already
                      exists but it&apos;s not linked with this authentication
                      method. <br />
                      Please sign in with email/password or the other provider
                      you used before and go to the <b>Settings</b> page to link
                      this one.
                    </Text>
                    <Button asChild marginTop={4} color="white">
                      <Link href="/settings/authentication">Sign in with another method</Link>
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
                      <Link href="/settings/authentication">Back to Settings</Link>
                    </Button>
                  </VStack>
                </Alert.Description>
              ) : (
                <Alert.Description>
                  Redirecting back to sign in, please try again...
                </Alert.Description>
              )}
            </Alert.Content>
          </Alert.Root>
        </Card.Body>
      </Card.Root>
    </Container>
  );
}
