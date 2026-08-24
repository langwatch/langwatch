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
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  FrontDoorShell,
  FrontDoorTraceDemo,
  useIdentityFrontDoor,
  VerificationFirstSignUp,
} from "~/features/auth-front-door";
import { HandledErrorAlert, readHandledError } from "~/features/errors";
import { signIn, useSession } from "~/utils/auth-client";
import { useSearchParams } from "~/utils/compat/next-navigation";
import { HorizontalFormControl } from "../../components/HorizontalFormControl";
import { LogoIcon } from "../../components/icons/LogoIcon";
import { Link } from "../../components/ui/link";
import { toaster } from "../../components/ui/toaster";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { api } from "../../utils/api";
import {
  authFailureMessage,
  isCredentialRejection,
} from "./authFailureMessage";

/**
 * Wording for a sign-in failure this screen can't name. The account has
 * already been created by the time that leg runs, so the copy says so rather
 * than implying the sign-up itself failed.
 */
const SIGN_UP_FALLBACK =
  "Your account was created — sign in with your new details.";

/**
 * The same wording for the other direction: the address already had an account
 * and the sign-in this screen ran on the customer's behalf failed for a reason
 * it can't name. Saying the account "was created" there would be a lie.
 */
const RECOVERY_FALLBACK =
  "That email already has an account. Sign in with it instead.";

/**
 * Which sign-up screen this deployment has (ADR-117 §7). The legacy screen
 * below is untouched and answers whenever the front door is not enforced.
 */
export default function SignUp() {
  const frontDoor = useIdentityFrontDoor();

  if (!frontDoor.isResolved) return null;
  if (frontDoor.enabled) {
    return (
      // The pitch is the hosted product's, and it lives OUTSIDE the card: the
      // card itself is the same on every installation. The trust strip is a
      // slot with nothing true to put in it yet, so it stays empty rather than
      // carrying a logo nobody agreed to.
      <FrontDoorShell
        headline="See what your agents are actually doing."
        headlineAccent="actually"
        tagline="Traces, evaluations and monitoring for every run. Free to start, no credit card."
        liveTrace={<FrontDoorTraceDemo />}
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
      password: z
        .string()
        .min(8, { message: "Password must be at least 8 characters" }),
      confirmPassword: z
        .string()
        .min(8, { message: "Password must be at least 8 characters" }),
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
  const [showRecoveryLinks, setShowRecoveryLinks] = useState(false);

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
      // An address that already has an account is not a wall, it is almost
      // always the customer's own: sign-up writes the account and its password
      // in one call and exchanges them for a session in another, so a failure
      // in the second leaves an account nobody ever mentions and every retry
      // lands here. It is also where someone who was a member before and got
      // invited back arrives, because an invite asks them to create an account
      // they already have. Carry on into the sign-in leg with the credentials
      // they just typed rather than dead-ending them on their own account.
      if (readHandledError(error)?.code !== "email_already_registered") {
        // Every other refusal renders in the alert below, through the code
        // registry. A toast here would only cover it with a vaguer line.
        return;
      }
      accountWasJustCreated = false;
    }

    // The account exists from here on, so this leg fails on its own terms —
    // and it has no alert of its own, which is why it toasts.
    //
    // next-auth answers with ITS OWN identifiers (`CredentialsSignin`,
    // `INVALID_ORIGIN`), which are not handled-error codes and so have no
    // registry entry. `authFailureMessage` is the mapping for those, and it
    // refuses to put a bare identifier on screen.
    setSignInLoading(true);
    let message: string | null = null;
    try {
      const response = await signIn("credentials", {
        email: values.email,
        password: values.password,
        callbackUrl: callbackUrl,
      });

      if (response?.error ?? (response?.status && response.status >= 400)) {
        // Recovering an existing account and the password was not its
        // password: the honest answer is the one the server already gave,
        // that address has an account, plus the two ways into it. Leave
        // `submitError` unset so the registry copy for
        // `email_already_registered` renders instead of being masked by a
        // sign-in sentence that would read as though the account were new.
        if (
          !accountWasJustCreated &&
          isCredentialRejection({
            code: response.code,
            message: response.error,
          })
        ) {
          setShowRecoveryLinks(true);
        } else {
          message = authFailureMessage({
            code: response.code,
            message: response.error,
            status: response.status,
            fallback: accountWasJustCreated
              ? SIGN_UP_FALLBACK
              : RECOVERY_FALLBACK,
          });
        }
      }
    } catch (error) {
      // A thrown exception is not the auth layer answering — it is the fetch
      // wrapper, a relayed response body, or anything else that blew up on the
      // way. `authFailureMessage`'s last branch paints any multi-word string
      // straight onto the screen, so feeding it `error.message` puts whatever
      // that was into the alert and the toast verbatim. Nothing here is copy,
      // so nothing here is shown: the caught error goes to the console for
      // whoever is debugging, and the customer reads the fallback.
      console.error("sign-in after sign-up threw", error);
      message = authFailureMessage({
        fallback: accountWasJustCreated ? SIGN_UP_FALLBACK : RECOVERY_FALLBACK,
      });
    } finally {
      setSignInLoading(false);
    }

    if (message) {
      setSubmitError(message);
      toaster.create({
        title: "Couldn't sign you in",
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
                invalid={
                  form.formState.errors.confirmPassword?.message !== undefined
                }
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
              ) : register.error ? (
                <HandledErrorAlert
                  error={register.error}
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
