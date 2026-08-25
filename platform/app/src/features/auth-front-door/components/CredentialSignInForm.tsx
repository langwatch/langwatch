import {
  Alert,
  Box,
  Button,
  HStack,
  IconButton,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { type RefObject, useState } from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { z } from "zod";
import { api } from "~/utils/api";
import Link from "~/utils/compat/next-link";
import "../authFrontDoor.css";
import { useFocusWhenSettled } from "../hooks/useFocusWhenSettled";
import { useRetryCountdown } from "../hooks/useRetryCountdown";
import { attemptCredentialSignIn } from "../logic/attemptCredentialSignIn";
import { BRAND, SHAPE } from "../logic/brand";
import { describeRemainingWait } from "../logic/credentialSignIn";
import { rememberLastUsedMethod } from "../logic/lastUsedMethod";
import { FIELD_FOCUS, FIELD_SURFACE, FrontDoorField } from "./FrontDoorField";

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
  const passwordField = useFocusWhenSettled();
  // The rate limiter's window, counted down where the person can see it. The
  // submit stays down until it runs out, so the one thing that cannot help is
  // also the one thing they cannot do.
  const { secondsToWait, startWait } = useRetryCountdown();

  const onSubmit = async (values: CredentialValues) => {
    setSubmitError(null);
    setIsSubmitting(true);
    const attempt = await attemptCredentialSignIn({
      email,
      password: values.password,
      callbackUrl,
      convertToSignUp: onSignUpStarted
        ? startPasswordSignUp.mutateAsync
        : undefined,
    });
    setIsSubmitting(false);

    if (attempt.outcome === "signed_in") {
      rememberLastUsedMethod({ id: "password" });
      return;
    }
    if (attempt.outcome === "signing_up") {
      onSignUpStarted?.(email);
      return;
    }

    if (attempt.retryAfterSeconds) startWait(attempt.retryAfterSeconds);
    setSubmitError(attempt.message);
  };

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={form.handleSubmit(onSubmit)} style={{ width: "100%" }}>
      <VStack width="full" align="stretch" gap="13px">
        <SettledEmailPill
          email={email}
          onUseDifferentEmail={onUseDifferentEmail}
        />
        {/* The address the password belongs to, kept in the form so a password
            manager can save and fill the pair. Read-only above, carried here. */}
        <input
          type="hidden"
          name="email"
          value={email}
          autoComplete="username"
          readOnly
        />
        <PasswordField
          form={form}
          fieldRef={passwordField}
          isRevealed={isRevealed}
          onToggleReveal={() => setIsRevealed((revealed) => !revealed)}
        />
        <SignInFailureAlert
          message={submitError}
          secondsToWait={secondsToWait}
        />
        <LogInButton
          isSubmitting={isSubmitting}
          isWaiting={secondsToWait !== null}
        />
      </VStack>
    </form>
  );
}

/**
 * The address the password is for, held in a quiet pill the way the board
 * draws it: settled, not editable here, one link out.
 */
function SettledEmailPill({
  email,
  onUseDifferentEmail,
}: {
  email: string;
  onUseDifferentEmail: () => void;
}) {
  return (
    <HStack
      width="full"
      justify="space-between"
      backgroundColor="bg.subtle"
      borderWidth="1px"
      borderRadius="full"
      paddingX="14px"
      paddingY="7px"
    >
      <Text
        fontSize="13px"
        color="fg.muted"
        truncate
        data-testid="routed-identifier"
      >
        {email}
      </Text>
      <Button
        variant="plain"
        size="xs"
        fontSize="12px"
        textDecoration="underline"
        textUnderlineOffset="2px"
        flexShrink={0}
        onClick={onUseDifferentEmail}
      >
        Use a different email
      </Button>
    </HStack>
  );
}

/**
 * The password, with the way out of a forgotten one on the label line and the
 * reveal toggle beside the field. The field keeps its own ref alongside the
 * one the form registers, so the entrance can take focus once it has settled.
 */
function PasswordField({
  form,
  fieldRef,
  isRevealed,
  onToggleReveal,
}: {
  form: UseFormReturn<CredentialValues>;
  fieldRef: RefObject<HTMLInputElement | null>;
  isRevealed: boolean;
  onToggleReveal: () => void;
}) {
  return (
    <FrontDoorField
      label="Password"
      labelEnd={
        <Box asChild>
          <Link
            href="/auth/forgot-password"
            style={{
              textDecoration: "underline",
              textUnderlineOffset: "2px",
              fontSize: "12px",
            }}
          >
            Forgot password?
          </Link>
        </Box>
      }
      error={form.formState.errors.password}
    >
      {(id) => (
        <HStack width="full" gap={2}>
          <Input
            id={id}
            type={isRevealed ? "text" : "password"}
            fontSize={{ base: "16px", md: "14px" }}
            minHeight="44px"
            borderRadius={SHAPE.field}
            autoComplete="current-password"
            {...FIELD_SURFACE}
            _focusVisible={FIELD_FOCUS}
            {...form.register("password")}
            ref={(node) => {
              form.register("password").ref(node);
              fieldRef.current = node;
            }}
          />
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={isRevealed ? "Hide password" : "Show password"}
            onClick={onToggleReveal}
          >
            {isRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
          </IconButton>
        </HStack>
      )}
    </FrontDoorField>
  );
}

/**
 * The refusal, in the words the mapper chose, with the rate limiter's
 * remaining window counted down beside it where there is one.
 */
function SignInFailureAlert({
  message,
  secondsToWait,
}: {
  message: string | null;
  secondsToWait: number | null;
}) {
  if (!message) return null;

  return (
    <Alert.Root
      status="error"
      borderStartWidth="4px"
      borderStartColor={BRAND.danger}
      color={BRAND.danger}
    >
      <Alert.Content>
        <Alert.Description data-testid="signin-failure">
          {message}
          {secondsToWait !== null ? (
            <>
              {" "}
              <span data-testid="retry-countdown">
                {describeRemainingWait(secondsToWait)}
              </span>
            </>
          ) : null}
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

/** The one action the screen offers, down for as long as the wait runs. */
function LogInButton({
  isSubmitting,
  isWaiting,
}: {
  isSubmitting: boolean;
  isWaiting: boolean;
}) {
  return (
    <Button
      className="lw-front-door-primary"
      type="submit"
      width="full"
      minHeight="44px"
      fontWeight={600}
      borderRadius={SHAPE.action}
      backgroundColor={BRAND.action}
      color={BRAND.onAction}
      _hover={{ backgroundColor: BRAND.actionHover }}
      loading={isSubmitting}
      disabled={isWaiting}
    >
      Log in
    </Button>
  );
}
