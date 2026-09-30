import "../../model/ambient.d.ts";
import { Alert, Box, Button, Input, VStack } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "@langwatch/browser-host/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { attemptCredentialSignIn } from "../../behavior/attempt-credential-sign-in.ts";
import { authApi as api } from "../../behavior/auth-api.ts";

import "../elements/auth-front-door.css";
import { useFocusWhenSettled } from "../../behavior/use-focus-when-settled.ts";
import { useRetryCountdown } from "../../behavior/use-retry-countdown.ts";
import { forgotPasswordHref } from "../../model/carried-email.ts";
import { describeRemainingWait } from "../../model/credential-sign-in.ts";
import { SHAPE } from "../../model/front-door-theme.ts";
import { rememberLastUsedMethod } from "../../model/last-used-method.ts";
import { startTwoStepChallenge } from "../../model/two-step-challenge.ts";
import { EmailPill } from "../elements/email-pill.tsx";
import { FIELD_FOCUS, FIELD_SURFACE, FrontDoorField } from "../elements/front-door-field.tsx";
import { PasswordInput } from "../elements/password-input.tsx";

const credentialSchema = z.object({
  // Blank when the address arrived settled from the address step; the field
  // only renders (and only validates) on the break-glass door, where no
  // address step ran.
  email: z.string(),
  password: z.string().min(1, { message: "Enter your password" }),
});

/** The break-glass door has to ask for the address itself. */
const breakGlassSchema = credentialSchema.safeExtend({
  email: z
    .string()
    .trim()
    .min(1, { message: "Enter your email address" })
    .email({ message: "Enter a valid email address" }),
});

type CredentialValues = z.infer<typeof credentialSchema>;

/**
 * Sign in with password for already-asked address; stays on form for password manager
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
   * Told when the address had no account, so a confirmation link went out
   * instead. The password typed here is NOT kept — it's chosen once the
   * address is confirmed, not here.
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
  // Does anybody hold this address? Asked of the ROUTER, which sends nothing:
  // asking by requesting a link mailed a stranger on every mistyped address.
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
            (await route.mutateAsync({ identifier: address })).outcome === "route_to_signup"
        : undefined,
    });
    setIsSubmitting(false);

    if (attempt.outcome === "signed_in") {
      rememberLastUsedMethod({ id: "password" });
      return;
    }
    if (attempt.outcome === "two_step_required") {
      // The card above becomes the code screen; a code box under a live
      // password field would invite a second attempt on top of this one.
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
    <form onSubmit={form.handleSubmit(onSubmit)} style={{ width: "100%" }}>
      <VStack width="full" align="stretch" gap="13px">
        {/* The address the password is for, in a quiet settled pill. Shown only
            when there IS one — an empty pill reads as a field that failed to
            load, not one that was never asked for (e.g. `?local=1`). */}
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
          <FrontDoorField label="Email" error={form.formState.errors.email}>
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
          </FrontDoorField>
        )}
        {email ? (
          // The address the password belongs to, kept in the form so a
          // password manager can save and fill the pair. Read-only above,
          // carried here. (The break-glass field above IS the form field, so
          // it needs no shadow copy.)
          <input type="hidden" name="email" value={email} autoComplete="username" readOnly />
        ) : null}
        <FrontDoorField
          label="Password"
          labelEnd={
            <Box asChild>
              <Link
                href={forgotPasswordHref({ email: asksForAddress ? form.watch("email") : email })}
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
            variant="outline"
            borderStartWidth="4px"
            borderStartColor={"frontDoor.danger"}
          >
            <Alert.Content>
              <Alert.Description data-testid="signin-failure" color={"frontDoor.danger"}>
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
          backgroundColor={"frontDoor.action"}
          color={"frontDoor.onAction"}
          _hover={{ backgroundColor: "frontDoor.actionHover" }}
          loading={isSubmitting}
          disabled={secondsToWait !== null}
        >
          Log in
        </Button>
      </VStack>
    </form>
  );
}
