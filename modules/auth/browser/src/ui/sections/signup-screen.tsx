import {
  Alert,
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
import { HorizontalFormControl } from "@langwatch/design-system/horizontal-form-control";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { authApi as api } from "../../behavior/auth-api.ts";
import { signIn, useSession } from "../../behavior/auth-client.tsx";
import { useShowErrorToast } from "../../behavior/auth-feedback.ts";
import { useIdentityFrontDoor } from "../../behavior/use-identity-front-door.ts";
import { usePublicEnv } from "../../behavior/use-public-env.ts";
import { useSearchParams } from "../../behavior/use-route.ts";
import { authFailureMessage, isCredentialRejection } from "../../model/auth-failure-message.ts";
import { readHandledError } from "../../model/read-handled-error.ts";
import { HandledErrorAlert } from "../../ui/elements/handled-error-alert.tsx";
import { Link } from "../../ui/elements/link.tsx";
import { LogoIcon } from "../../ui/elements/logo-icon.tsx";
import { FrontDoorShell } from "../../ui/sections/front-door-shell.tsx";
import { VerificationFirstSignUp } from "../../ui/sections/verification-first-sign-up.tsx";

/**
 * Wording for a sign-in failure this screen can't name. The account has
 * already been created by the time that leg runs, so the copy says so rather
 * than implying the sign-up itself failed.
 */
const SIGN_UP_FALLBACK = "Your account was created. Sign in with your new details.";

/**
 * The same wording for the other direction: the address already had an account
 * and the sign-in this screen ran on the customer's behalf failed for a reason
 * it can't name. Saying the account "was created" there would be a lie.
 */
const RECOVERY_FALLBACK = "That email already has an account. Sign in with it instead.";

/**
 * Which sign-up screen this deployment has (ADR-117 §7). The legacy screen
 * below is untouched and answers whenever the front door is not enforced.
 */
export default function SignUp() {
  const frontDoor = useIdentityFrontDoor();

  if (!frontDoor.isResolved) return null;
  if (frontDoor.enabled) {
    return (
      // Hosted product pitch outside card; trustStrip empty until cleared for customer quote
      <FrontDoorShell
        headline={"See what your agents\nare actually doing."}
        headlineAccent="actually"
        // Names the thing they are seconds away from, rather than listing what
        // the product has. "Traces, evaluations and monitoring" was a feature
        // list read by somebody who has not agreed to want any of them yet.
        tagline="You are a minute away from watching a simulated user push your agent until it breaks. Free to start, no credit card."
      >
        <VerificationFirstSignUp />
      </FrontDoorShell>
    );
  }

  return <LegacySignUp />;
}

function LegacySignUp() {
  const { data: session } = useSession();
  const publicEnv = usePublicEnv();
  const isAuthProvider = publicEnv.data?.NEXTAUTH_PROVIDER;
  const callbackUrl = useSearchParams()?.get("callbackUrl") ?? undefined;

  useEffect(() => {
    if (!publicEnv.data) {
      return;
    }

    if (!session && isAuthProvider && isAuthProvider !== "email") {
      void signIn(isAuthProvider, { callbackUrl });
    }
  }, [publicEnv.data, session, callbackUrl, isAuthProvider]);

  if (!publicEnv.data) {
    return null;
  }

  return isAuthProvider && isAuthProvider !== "email" ? (
    <div style={{ padding: "12px" }}>Redirecting to Sign in...</div>
  ) : (
    <SignUpForm />
  );
}

// Auth redirect is now handled client-side via useSession() + useEffect in the component

function messageForSignInResponse({
  response,
  accountWasJustCreated,
  showRecoveryLinks,
}: {
  response: Awaited<ReturnType<typeof signIn>>;
  accountWasJustCreated: boolean;
  showRecoveryLinks: () => void;
}): string | null {
  if (!(response?.error ?? (response?.status && response.status >= 400))) return null;

  const credentialWasRejected = isCredentialRejection({
    code: response.code,
    message: response.error,
  });
  if (!accountWasJustCreated && credentialWasRejected) {
    showRecoveryLinks();
    return null;
  }

  return authFailureMessage({
    code: response.code,
    message: response.error,
    status: response.status,
    fallback: accountWasJustCreated ? SIGN_UP_FALLBACK : RECOVERY_FALLBACK,
  });
}

function SignUpForm() {
  const query = useSearchParams();
  const callbackUrl = query?.get("callbackUrl") ?? undefined;
  // Where this screen sends someone who turns out to already have an account.
  // Keeps the callback so an invite they were following survives the detour.
  const signInHref = `/auth/signin${
    callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""
  }`;

  const schema = z
    .object({
      name: z.string().min(1, { message: "Name is required" }),
      email: z.string().min(1).email(),
      password: z.string().min(8, { message: "Password must be at least 8 characters" }),
      confirmPassword: z.string().min(8, { message: "Password must be at least 8 characters" }),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: "Passwords don't match",
      path: ["confirmPassword"], // Set the path of the error to confirmPassword field
    });

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
  });

  const register = api.user.register.useMutation();
  const [signInLoading, setSignInLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const registerError = submitError ? null : register.error;
  const [showRecoveryLinks, setShowRecoveryLinks] = useState(false);
  const showErrorToast = useShowErrorToast();

  const onSubmit = async (values: z.infer<typeof schema>) => {
    setSubmitError(null);
    setShowRecoveryLinks(false);

    // Whether this submit created the account, or found one already there.
    // The two legs below read differently depending on the answer, because a
    // sign-in failure means "your new account is waiting for you" in the first
    // case and "this is not your account's password" in the second.
    let accountWasJustCreated = true;
    try {
      await register.mutateAsync(values);
    } catch (error) {
      // An address with an account isn't a wall — usually the customer's own:
      // sign-up writes the account then exchanges credentials for a session
      // in a second call, so a failure there leaves an orphaned account every
      // retry lands here. Also where a re-invited former member arrives. Carry
      // on into sign-in with the credentials just typed, not a dead end.
      if (readHandledError(error)?.code !== "email_already_registered") {
        // Every other refusal renders in the alert below, through the code
        // registry. A toast here would only cover it with a vaguer line.
        return;
      }
      accountWasJustCreated = false;
    }

    // The account exists from here on, so this leg fails on its own terms
    // and toasts (no alert of its own). next-auth answers with ITS OWN
    // identifiers (`CredentialsSignin`, `INVALID_ORIGIN`), not handled-error
    // codes, so `authFailureMessage` maps them rather than showing a bare identifier.
    setSignInLoading(true);
    let message: string | null = null;
    // The refusal itself, where there was one to catch. A provider that
    // ANSWERS "no" leaves this undefined: there is no error object in that
    // branch, only the response the sentence above was composed from.
    let refusal: unknown;
    try {
      const response = await signIn("credentials", {
        email: values.email,
        password: values.password,
        callbackUrl: callbackUrl,
      });

      message = messageForSignInResponse({
        response,
        accountWasJustCreated,
        showRecoveryLinks: () => setShowRecoveryLinks(true),
      });
    } catch (error) {
      // A thrown exception isn't the auth layer answering — it's the fetch
      // wrapper or something that blew up. `authFailureMessage`'s last branch
      // paints any multi-word string straight onto the screen, so feeding it
      // `error.message` would leak it verbatim. The caught error goes to the
      // console instead; the customer reads the fallback.
      console.error("sign-in after sign-up threw", error);
      refusal = error;
      message = authFailureMessage({
        fallback: accountWasJustCreated ? SIGN_UP_FALLBACK : RECOVERY_FALLBACK,
      });
    } finally {
      setSignInLoading(false);
    }

    if (message) {
      setSubmitError(message);
      showErrorToast({
        error: refusal,
        fallbackTitle: "Couldn't sign you in",
        description: message,
      });
    }
  };

  return (
    <Container maxW="container.md" paddingTop="calc(40vh - 164px)">
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card.Root>
          <Card.Header>
            <HStack gap={4}>
              <LogoIcon width={30.69} height={42} />
              <Heading size="lg" as="h1">
                Sign up
              </Heading>
            </HStack>
          </Card.Header>
          <Card.Body>
            <VStack width="full">
              <HorizontalFormControl
                label="Name"
                helper="Enter your name"
                invalid={form.formState.errors.name?.message !== undefined}
                error={form.formState.errors.name}
              >
                <Input {...form.register("name")} />
              </HorizontalFormControl>
              <HorizontalFormControl
                label="Email"
                helper="Enter your email"
                invalid={form.formState.errors.email?.message !== undefined}
                error={form.formState.errors.email}
              >
                <Input type="email" {...form.register("email")} />
              </HorizontalFormControl>
              <HorizontalFormControl
                label="Password"
                helper="Enter your password"
                invalid={form.formState.errors.password?.message !== undefined}
                error={form.formState.errors.password}
              >
                <Input type="password" {...form.register("password")} />
              </HorizontalFormControl>
              <HorizontalFormControl
                label="Confirm Password"
                helper="Confirm your password"
                invalid={form.formState.errors.confirmPassword?.message !== undefined}
                error={form.formState.errors.confirmPassword}
              >
                <Input type="password" {...form.register("confirmPassword")} />
              </HorizontalFormControl>
              {/* Two different failures, two different readers of the code:
                  `submitError` is already customer-safe prose from
                  `authFailureMessage` (next-auth's identifiers), while
                  `register.error` is a tRPC handled error whose wire message
                  IS the code slug since #5984 — so it goes through the
                  registry rather than being printed. */}
              {submitError ? (
                <Alert.Root
                  borderStartWidth="4px"
                  borderStartColor="colorPalette.solid"
                  colorPalette="red"
                >
                  <Alert.Content>
                    <Alert.Description>{submitError}</Alert.Description>
                  </Alert.Content>
                </Alert.Root>
              ) : null}
              {registerError ? (
                <HandledErrorAlert
                  error={registerError}
                  fallbackTitle="Couldn't create your account"
                />
              ) : null}
              {/* Shown only once the sign-in this screen ran on the customer's
                  behalf came back with the wrong password for an account that
                  does exist. The copy above names the situation; these are the
                  two ways out of it. The sign-in link carries the callback so
                  the invite they were following survives the detour; the reset
                  flow returns through the emailed link instead. */}
              {showRecoveryLinks ? (
                <HStack width="full" gap={4}>
                  <Link href={signInHref} textDecoration="underline">
                    Sign in
                  </Link>
                  <Link href="/auth/forgot-password" textDecoration="underline">
                    Reset your password
                  </Link>
                </HStack>
              ) : null}
              <HStack width="full" paddingTop={4}>
                <Link href={signInHref} textDecoration="underline">
                  Already have an account?
                </Link>
                <Spacer />
                <Button
                  colorPalette="orange"
                  type="submit"
                  loading={register.isPending || signInLoading}
                >
                  Sign up
                </Button>
              </HStack>
            </VStack>
          </Card.Body>
        </Card.Root>
      </form>
    </Container>
  );
}
