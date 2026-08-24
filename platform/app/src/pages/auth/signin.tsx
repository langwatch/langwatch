import {
  Alert,
  Box,
  Button,
  Card,
  Container,
  Heading,
  HStack,
  Input,
  Spacer,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  FrontDoorShell,
  IdentifierFirstSignIn,
  useIdentityFrontDoor,
} from "~/features/auth-front-door";
import { safeRedirectTarget, signIn, useSession } from "~/utils/auth-client";
import { replaceLocation } from "~/utils/browserNavigation";
import Link from "~/utils/compat/next-link";
import { useSearchParams } from "~/utils/compat/next-navigation";
import { HorizontalFormControl } from "../../components/HorizontalFormControl";
import { LogoIcon } from "../../components/icons/LogoIcon";
import { toaster } from "../../components/ui/toaster";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { authFailureMessage } from "./authFailureMessage";
import { isStableAuthError, normalizeErrorCode, SignInError } from "./error";

/**
 * Which sign-in screen this deployment has (ADR-117 §7).
 *
 * Until the flip, and after a rollback, the legacy screen below answers
 * exactly as it always has: this component adds a branch in front of it and
 * changes nothing inside it. Neither renders until the deployment has said
 * which one it is, because guessing would flash the wrong door on every load.
 */
export default function SignIn() {
  const frontDoor = useIdentityFrontDoor();

  if (!frontDoor.isResolved) return null;
  if (frontDoor.enabled) {
    return (
      // Log-in has no case to make: the person already has an account and is
      // trying to get to it. The panel appears on the hosted sign-up, where a
      // first-time visitor is deciding.
      <FrontDoorShell>
        <IdentifierFirstSignIn />
      </FrontDoorShell>
    );
  }

  return <LegacySignIn />;
}

function LegacySignIn() {
  const { data: session } = useSession();
  const query = useSearchParams();
  const rawError = query?.get("error");
  // Normalize BetterAuth error codes so the auto-redirect gate works.
  // e.g. "account_already_linked_to_different_user" → "OAuthAccountNotLinked"
  const error = normalizeErrorCode(rawError);

  const publicEnv = usePublicEnv();
  const isAuthProvider = publicEnv.data?.NEXTAUTH_PROVIDER;
  const callbackUrl = query?.get("callbackUrl") ?? undefined;

  const isSocialProvider = isAuthProvider && isAuthProvider !== "email";

  useEffect(() => {
    if (!publicEnv.data) return;

    // Already-signed-in users hitting /auth/signin should bounce to their
    // callback (or dashboard) instead of staring at a 'Redirecting to Sign
    // in...' splash forever (ariana dogfood finding #2).
    if (session) {
      replaceLocation(safeRedirectTarget(callbackUrl));
      return;
    }

    let signInTimeout: ReturnType<typeof setTimeout> | undefined;

    // Don't auto-redirect back to the identity provider on a stable failure
    // (wrong method / account collision): the IdP still holds a live session
    // for the failing identity, so re-initiating sign-in silently re-auths it
    // and traps the user in a loop. Those errors render SignInError with a
    // federated-logout recovery instead.
    if (!isStableAuthError(error) && isSocialProvider) {
      signInTimeout = setTimeout(
        () => {
          void signIn(isAuthProvider, { callbackUrl });
        },
        error ? 2000 : 0,
      );
    }

    return () => {
      if (signInTimeout) clearTimeout(signInTimeout);
    };
  }, [
    publicEnv.data,
    session,
    callbackUrl,
    isAuthProvider,
    isSocialProvider,
    error,
  ]);

  if (error) {
    return <SignInError error={error} />;
  }

  if (!publicEnv.data) {
    return null;
  }

  // Show a friendlier message if the user is already signed in (the
  // useEffect above triggers the redirect — this is the transient splash
  // for ~1 paint frame). Distinguishes the two very different states that
  // used to render the same "Redirecting to Sign in..." string.
  if (session) {
    return <Box padding="12px">Already signed in — redirecting…</Box>;
  }

  if (isSocialProvider) {
    return <Box padding="12px">Redirecting to Sign in...</Box>;
  }

  return <SignInForm />;
}

// Auth redirect is now handled client-side via useSession() + useEffect in the component

function SignInForm() {
  const query = useSearchParams();
  const callbackUrl = query?.get("callbackUrl") ?? undefined;

  const schema = z.object({
    email: z.string().email(),
    password: z.string(),
  });

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
  });

  const [signInLoading, setSignInLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: z.infer<typeof schema>) => {
    setSubmitError(null);
    setSignInLoading(true);

    let message: string | null = null;
    try {
      const response = await signIn("credentials", {
        email: values.email,
        password: values.password,
        callbackUrl: callbackUrl,
      });

      if (response?.error ?? (response?.status && response.status >= 400)) {
        message = authFailureMessage({
          code: response.code,
          message: response.error,
          status: response.status,
        });
      }
    } catch (error) {
      message = authFailureMessage({
        message: error instanceof Error ? error.message : void 0,
      });
    } finally {
      setSignInLoading(false);
    }

    if (message) {
      setSubmitError(message);
      toaster.create({
        title: "Could not sign in",
        description: message,
        type: "error",
      });
    }
  };

  return (
    <Container maxW="container.md" paddingTop="calc(40vh - 164px)">
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card.Root>
          <Card.Header>
            <HStack gap={4}>
              <LogoIcon width={30.69} height={42} />
              <Heading size="lg" as="h1">
                Sign in
              </Heading>
            </HStack>
          </Card.Header>
          <Card.Body>
            <VStack width="full">
              <HorizontalFormControl
                label="Email"
                helper="Enter your email"
                invalid={form.formState.errors.email?.message !== undefined}
              >
                <Input type="email" {...form.register("email")} />
              </HorizontalFormControl>
              <HorizontalFormControl
                label="Password"
                helper="Enter your password"
                invalid={form.formState.errors.password?.message !== undefined}
              >
                <VStack align="stretch" gap={2} width="full">
                  <Input type="password" {...form.register("password")} />
                  <HStack width="full">
                    <Spacer />
                    <Box asChild>
                      <Link
                        href="/auth/forgot-password"
                        style={{
                          textDecoration: "underline",
                          fontSize: "14px",
                        }}
                      >
                        Forgot password?
                      </Link>
                    </Box>
                  </HStack>
                </VStack>
              </HorizontalFormControl>
              {submitError && (
                <Alert.Root status="error">
                  <Alert.Indicator />
                  <Alert.Content>{submitError}</Alert.Content>
                </Alert.Root>
              )}
              <HStack width="full" paddingTop={4}>
                <Box asChild>
                  <Link
                    href={`/auth/signup${
                      callbackUrl
                        ? `?callbackUrl=${encodeURIComponent(callbackUrl)}`
                        : ""
                    }`}
                    style={{ textDecoration: "underline" }}
                  >
                    Register new account
                  </Link>
                </Box>
                <Spacer />
                <Button
                  colorPalette="orange"
                  type="submit"
                  loading={signInLoading}
                >
                  Sign in
                </Button>
              </HStack>
            </VStack>
          </Card.Body>
        </Card.Root>
      </form>
    </Container>
  );
}
