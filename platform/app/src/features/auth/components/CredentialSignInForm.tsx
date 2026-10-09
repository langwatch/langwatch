import { Alert, Box, Input, VStack } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api } from "~/utils/api";
import Link from "~/utils/compat/next-link";
import "../auth.css";
import { SHAPE } from "../authTheme";
import { useFocusWhenSettled } from "../hooks/useFocusWhenSettled";
import { useRetryCountdown } from "../hooks/useRetryCountdown";
import { attemptCredentialSignIn } from "../logic/attemptCredentialSignIn";
import { forgotPasswordHref } from "../logic/carriedEmail";
import { describeRemainingWait } from "../logic/credentialSignIn";
import { rememberLastUsedMethod } from "../logic/lastUsedMethod";
import { startTwoStepChallenge } from "../logic/twoStepChallenge";
import { AuthField, FIELD_FOCUS, FIELD_SURFACE } from "./AuthField";
import { AuthPrimaryButton } from "./AuthPrimaryButton";
import { EmailPill } from "./EmailPill";
import { PasswordInput } from "./PasswordInput";

const credentialSchema = z.object({
  // Blank when the address arrived settled from the address step; the field
  // only renders (and only validates) on the break-glass door, where no
  // address step ran.
  email: z.string(),
  password: z.string().min(1, { message: "Enter your password" }),
});

/** The break-glass door has to ask for the address itself. */
const breakGlassSchema = credentialSchema.extend({
  email: z
    .string()
    .trim()
    .min(1, { message: "Enter your email address" })
    .email({ message: "Enter a valid email address" }),
});

type CredentialValues = z.infer<typeof credentialSchema>;

/**
 * Signing in with the password held for an address the auth screens already
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
 * uses, and never put an internal code on screen.
 *
 * On whether the address has an account: the SCREEN says nothing, but the
 * unified funnel deliberately does not pretend — an address with no account
 * converts to sign-up (the credential step) where a held account answers
 * "invalid password". That asymmetry is ADR-117 §6 (Revision 2026-08-24),
 * which retired the no-oracle invariant at the screen level and scoped it to
 * the router and reset; the spec header in signin-signup-screens.feature
 * carries the argument.
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
   * Told when the address turned out to have no account, so the journey is a
   * sign-up. NOTHING has been created and nothing has been sent: the screen's
   * next move is the credential step, and the call that takes a password or a
   * passkey there is what creates the account and mails the link.
   *
   * The password typed here is not kept and does not travel — it is chosen
   * again on that step, typed twice and held to a length. Absent where an
   * account is already known to exist, in which case a refusal is only ever a
   * wrong password.
   */
  onSignUpStarted?: (email: string) => void;
}) {
  // No address means no address step ran — the break-glass door
  // (`?local=1`) renders this form cold, and it has to be able to ask for
  // the address itself or it is a password box that can only ever fail.
  const asksForAddress = email === "";
  const form = useForm<CredentialValues>({
    resolver: zodResolver(asksForAddress ? breakGlassSchema : credentialSchema),
    defaultValues: { email, password: "" },
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
  // The question the refusal above cannot answer on its own: does anybody hold
  // this address? Asked of the ROUTER, which already answers it for the
  // address step and sends nothing to anybody. It used to be asked by
  // requesting a confirmation link and seeing whether that was refused, which
  // mailed a stranger every time somebody mistyped their own address.
  const route = api.auth.route.useMutation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const passwordField = useFocusWhenSettled();
  // The rate limiter's window, counted down where the person can see it. The
  // submit stays down until it runs out, so the one thing that cannot help is
  // also the one thing they cannot do.
  const { secondsToWait, startWait } = useRetryCountdown();

  const onSubmit = async (values: CredentialValues) => {
    const address = asksForAddress ? values.email.trim() : email;
    setSubmitError(null);
    setIsSubmitting(true);
    const attempt = await attemptCredentialSignIn({
      email: address,
      password: values.password,
      callbackUrl,
      addressHasNoAccount: onSignUpStarted
        ? async ({ email: address }) =>
            (await route.mutateAsync({ identifier: address })).outcome ===
            "route_to_signup"
        : undefined,
    });
    setIsSubmitting(false);

    if (attempt.outcome === "signed_in") {
      rememberLastUsedMethod({ id: "password" });
      return;
    }
    if (attempt.outcome === "two_step_required") {
      // The card above this form becomes the code screen. Not this form's job
      // to draw it: a challenge takes the whole card the same way a passkey
      // ceremony does, and a code box appearing under a live password field
      // invites a second attempt on top of the one still standing.
      startTwoStepChallenge({ callbackUrl });
      return;
    }
    if (attempt.outcome === "signing_up") {
      onSignUpStarted?.(address);
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
        ) : (
          // The break-glass door renders this form with no address step in
          // front of it, so the address is asked for HERE — without this
          // field the emergency door was a password box that could only post
          // an empty username, unusable exactly when the IdP path is broken.
          <AuthField label="Email" error={form.formState.errors.email}>
            {(id) => (
              <Input
                id={id}
                type="email"
                placeholder="you@company.com"
                fontSize={{ base: "16px", md: "14px" }}
                minHeight="44px"
                borderRadius={SHAPE.field}
                autoComplete="username"
                {...FIELD_SURFACE}
                _focusVisible={FIELD_FOCUS}
                {...form.register("email")}
              />
            )}
          </AuthField>
        )}
        {email ? (
          // The address the password belongs to, kept in the form so a
          // password manager can save and fill the pair. Read-only above,
          // carried here. (The break-glass field above IS the form field, so
          // it needs no shadow copy.)
          <input
            type="hidden"
            name="email"
            value={email}
            autoComplete="username"
            readOnly
          />
        ) : null}
        <AuthField
          label="Password"
          labelEnd={
            <Box asChild>
              <Link
                // The address travels in the fragment, never the query, for
                // the reason `carriedEmail` gives: it is the one personal
                // datum on this screen and a query string is written down by
                // every hop it passes.
                href={forgotPasswordHref({
                  email: asksForAddress ? form.watch("email") : email,
                })}
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
        </AuthField>
        {submitError ? (
          <Alert.Root
            status="error"
            borderStartWidth="4px"
            borderStartColor={"auth.danger"}
            color={"auth.danger"}
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
        <AuthPrimaryButton
          type="submit"
          isBusy={isSubmitting}
          isDisabled={secondsToWait !== null}
        >
          Log in
        </AuthPrimaryButton>
      </VStack>
    </form>
  );
}
