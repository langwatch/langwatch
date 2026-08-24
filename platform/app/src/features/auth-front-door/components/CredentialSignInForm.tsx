import { Alert, Box, Button, VStack } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
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
import { EmailPill } from "./EmailPill";
import { FrontDoorField } from "./FrontDoorField";
import { PasswordInput } from "./PasswordInput";

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
   * Told when the address turned out to have no account, so a confirmation
   * link went out instead. The password typed here is NOT kept — it is chosen
   * once, after the address is confirmed, on the screen built to ask for it.
   * Absent where an account is already known to exist, in which case a refusal
   * is only ever a wrong password.
   */
  onSignUpStarted?: (email: string) => void;
}) {
  const form = useForm<CredentialValues>({
    resolver: zodResolver(credentialSchema),
    // Nothing validates automatically; the handlers below decide when a
    // judgement is welcome — the same line the address step takes.
    mode: "onSubmit",
    reValidateMode: "onSubmit",
  });

  // A password you have typed something into can be judged when you leave it;
  // an empty one cannot, because you have not tried yet. Clicking past it to
  // reach the reveal toggle, "Forgot password?" or a password manager is not
  // a mistake, and answering it with "required" is the screen telling somebody
  // off for looking around.
  const passwordRegistration = form.register("password", {
    onBlur: () => {
      const value = form.getValues("password");
      if (value) void form.trigger("password");
      else form.clearErrors("password");
    },
    onChange: () => {
      // Clearing only: typing can lift a rejection, never earn one.
      if (!form.formState.errors.password) return;
      const parsed = credentialSchema.safeParse({
        password: form.getValues("password"),
      });
      if (parsed.success) form.clearErrors("password");
    },
  });
  // The same request the sign-up door makes, because from here on it IS the
  // sign-up door: no password travels with it, and the one that was typed
  // above is not kept.
  const requestSignUpVerification =
    api.frontDoor.requestSignUpVerification.useMutation();
  const [isSubmitting, setIsSubmitting] = useState(false);
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
        ? requestSignUpVerification.mutateAsync
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
        {/* The address the password is for, held in a quiet pill the way the
            board draws it: settled, not editable here, one link out.

            Only when there IS one. The local door can be asked for by name
            (`?local=1`) and renders this form without an address having been
            typed, and an empty pill is a row of furniture holding nothing —
            it reads as a field that failed to load rather than one that was
            never asked for. */}
        {email ? (
          <EmailPill
            email={email}
            actionLabel="Use a different email"
            onAction={onUseDifferentEmail}
            testId="routed-identifier"
          />
        ) : null}
        {/* The address the password belongs to, kept in the form so a password
            manager can save and fill the pair. Read-only above, carried here. */}
        <input
          type="hidden"
          name="email"
          value={email}
          autoComplete="username"
          readOnly
        />
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
            <PasswordInput
              id={id}
              autoComplete="current-password"
              registration={passwordRegistration}
              inputRef={passwordField}
            />
          )}
        </FrontDoorField>
        {submitError ? (
          <Alert.Root
            status="error"
            borderStartWidth="4px"
            borderStartColor={BRAND.danger}
            color={BRAND.danger}
          >
            <Alert.Content>
              <Alert.Description data-testid="signin-failure">
                {submitError}
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
        ) : null}
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
          disabled={secondsToWait !== null}
        >
          Log in
        </Button>
      </VStack>
    </form>
  );
}
