import {
  Alert,
  Box,
  Button,
  HStack,
  IconButton,
  Input,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { HorizontalFormControl } from "~/components/HorizontalFormControl";
import {
  authFailureMessage,
  isCredentialRejection,
} from "~/pages/auth/authFailureMessage";
import { api } from "~/utils/api";
import { signIn } from "~/utils/auth-client";
import Link from "~/utils/compat/next-link";
import "../authFrontDoor.css";
import { BRAND, SHAPE } from "../logic/brand";
import { credentialSignInFailure } from "../logic/credentialSignIn";
import { rememberLastUsedMethod } from "../logic/lastUsedMethod";

const credentialSchema = z.object({
  password: z.string().min(1, { message: "Enter your password" }),
});

type CredentialValues = z.infer<typeof credentialSchema>;

/**
 * Signing in with the password held for an address the front door already
 * asked for.
 *
 * The address stays on screen and stays in the form: a password manager needs
 * the pair to save or fill it, and somebody who has got this far should never
 * be asked to type their address twice. The password field is spelled
 * `current-password` for the same reason.
 *
 * The failure wording is the anchor `sign-in-failure-messages.feature` holds:
 * a wrong password, a rate limit and an installation set up for another
 * address each say their own thing, through the same mapper the legacy screen
 * uses, and never put an internal code on screen. It says nothing about
 * whether the address has an account, ever.
 */
export function CredentialSignInForm({
  email,
  callbackUrl,
  onUseDifferentEmail,
  onSignUpStarted,
}: {
  email: string;
  callbackUrl?: string;
  onUseDifferentEmail: () => void;
  /**
   * Told when the address turned out to have no account and the password
   * became a sign-up instead. Absent where an account is already known to
   * exist, in which case a refusal is only ever a wrong password.
   */
  onSignUpStarted?: (email: string) => void;
}) {
  const form = useForm<CredentialValues>({
    resolver: zodResolver(credentialSchema),
    mode: "onBlur",
  });
  const startPasswordSignUp = api.frontDoor.startPasswordSignUp.useMutation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: CredentialValues) => {
    setSubmitError(null);
    setIsSubmitting(true);

    let message: string | null = null;
    let rejected = false;
    try {
      const response = await signIn("credentials", {
        email,
        password: values.password,
        callbackUrl,
      });
      message = credentialSignInFailure({ response });
      rejected = isCredentialRejection({
        code: response?.code,
        message: response?.error,
      });
    } catch (error) {
      message = authFailureMessage({
        message: error instanceof Error ? error.message : void 0,
      });
    } finally {
      setIsSubmitting(false);
    }

    if (!message) {
      rememberLastUsedMethod({ id: "password" });
      return;
    }

    // A refused credential is one of two situations, and only the server can
    // tell them apart: a password that is wrong for an account that exists, or
    // an address nobody has an account for at all. The second is somebody
    // signing up at the log-in form, so it carries on as a sign-up rather than
    // becoming a refusal they have to act on.
    if (rejected && onSignUpStarted) {
      setIsSubmitting(true);
      try {
        const answer = await startPasswordSignUp.mutateAsync({
          email,
          password: values.password,
        });
        if (answer.outcome === "verification_sent") {
          onSignUpStarted(email);
          return;
        }
      } catch {
        // Rate-limited or unreachable: the honest failure below still stands.
      } finally {
        setIsSubmitting(false);
      }
    }

    setSubmitError(message);
  };

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={form.handleSubmit(onSubmit)} style={{ width: "100%" }}>
      <VStack width="full" align="stretch" gap={3}>
        <HStack width="full">
          <Text data-testid="routed-identifier">{email}</Text>
          <Spacer />
          <Button variant="plain" size="sm" onClick={onUseDifferentEmail}>
            Use a different email
          </Button>
        </HStack>
        {/* The address the password belongs to, kept in the form so a password
            manager can save and fill the pair. Read-only above, carried here. */}
        <input
          type="hidden"
          name="email"
          value={email}
          autoComplete="username"
          readOnly
        />
        <HorizontalFormControl
          direction="vertical"
          size="sm"
          label={
            <HStack width="full" gap={3}>
              <Text>Password</Text>
              <Spacer />
              <Box asChild>
                <Link
                  href="/auth/forgot-password"
                  style={{ textDecoration: "underline", fontSize: "13px" }}
                >
                  Forgot password?
                </Link>
              </Box>
            </HStack>
          }
          helper="Enter your password"
          invalid={form.formState.errors.password?.message !== undefined}
          error={form.formState.errors.password}
        >
          <HStack width="full" gap={2}>
            <Input
              type={isRevealed ? "text" : "password"}
              fontSize={{ base: "16px", md: "sm" }}
              minHeight="44px"
              borderRadius={SHAPE.field}
              autoComplete="current-password"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              {...form.register("password")}
            />
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={isRevealed ? "Hide password" : "Show password"}
              onClick={() => setIsRevealed((revealed) => !revealed)}
            >
              {isRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
            </IconButton>
          </HStack>
        </HorizontalFormControl>
        {submitError ? (
          <Alert.Root
            status="error"
            borderStartWidth="4px"
            borderStartColor="colorPalette.solid"
            colorPalette="red"
          >
            <Alert.Content>
              <Alert.Description>{submitError}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        ) : null}
        <Button
          className="lw-front-door-primary"
          type="submit"
          width="full"
          minHeight="44px"
          borderRadius={SHAPE.action}
          backgroundColor={BRAND.action}
          color={BRAND.onAction}
          _hover={{ backgroundColor: BRAND.actionHover }}
          loading={isSubmitting}
        >
          Log in
        </Button>
      </VStack>
    </form>
  );
}
