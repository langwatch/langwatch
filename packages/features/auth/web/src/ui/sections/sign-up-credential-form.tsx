/// <reference path="../../types/ambient.d.ts" />
import { Alert, Button, Text, VStack } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  PASSWORD_REQUIREMENTS_HINT,
  passwordProblem,
} from "@langwatch/identity-contract";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { applyHandledErrorToForm } from "../../model/apply-handled-error-to-form";
import { FormServerError } from "../elements/form-server-error";
import { HandledErrorAlert } from "../elements/handled-error-alert";
import { readHandledError } from "../../model/read-handled-error";
import { usePublicEnv } from "../../behavior/use-public-env";
import { authFailureMessage } from "../../model/auth-failure-message";
import { authApi as api } from "../../behavior/auth-api";
import { signIn } from "../../behavior/auth-client";
import { credentialSignInFailure } from "../../model/credential-sign-in";
import { rememberLastUsedMethod } from "../../model/last-used-method";
import "./auth-front-door.css";
import { SHAPE } from "../../model/front-door-theme";
import { EmailPill } from "../elements/email-pill";
import { FrontDoorField } from "../elements/front-door-field";
import { PasskeySignUpButton } from "../elements/passkey-sign-up-button";
import { PasswordInput } from "../elements/password-input";
import { MethodDivider } from "../blocks/sign-in-method-picker";

// No name. Onboarding asks for it, in a place where it is worth asking —
// putting it here charges a field at the one moment somebody has least
// patience for one, to learn something the next screen learns anyway.
//
// The rules come from `@langwatch/identity-contract`, which the mutation behind this
// form reads too, so the form cannot accept what the server refuses. Asked as
// a refinement rather than restated as zod constraints for the same reason:
// restating them is how they drift.
const signUpSchema = z
  .object({
    password: z.string().superRefine((value, ctx) => {
      const problem = passwordProblem(value);
      if (problem) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
      }
    }),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "The two passwords are not the same",
    path: ["confirmPassword"],
  });

type SignUpValues = z.infer<typeof signUpSchema>;

/**
 * The account exists by the time the sign-in leg runs, so a failure there says
 * so: implying the sign-up itself failed would send somebody back to create an
 * account they already have.
 */
const ACCOUNT_CREATED_FALLBACK =
  "Your account was created. Log in with your new details to carry on.";

/**
 * Choosing how to sign in, which is the step that creates the account. It
 * takes a passkey or a password, and either one finishes the sign-up.
 *
 * The password half registers, signs in, and sends the address confirmation
 * after both — the
 * confirmation follows somebody in rather than standing in front of them
 * (ADR-117 §6, revised). The address is the one typed on the step before and
 * is not asked for again: it rides along in a hidden field so a password
 * manager saves the pair, and cannot be edited here, because the pair being
 * saved has to be the pair that was registered.
 *
 * The password is typed twice and held to a length. That is the ONLY place
 * either happens, on either door — the log-in form's single `current-password`
 * field never becomes an account's password.
 *
 * A rejection lands on the field that caused it, in words that say what to
 * change. Validation runs on blur in the same words, so most of the time the
 * server never has to answer at all.
 */
export function SignUpCredentialForm({
  email,
  callbackUrl,
  onUseDifferentEmail,
  onAddressAlreadyRegistered,
}: {
  email: string;
  callbackUrl: string;
  /** Back to the address step, for the address that was typed wrong. */
  onUseDifferentEmail: () => void;
  /**
   * The address turned out to have an account. Not a refusal and not a field
   * error — it is the wrong door, and the screen becomes the right one with
   * the address already in it.
   */
  onAddressAlreadyRegistered?: () => void;
}) {
  const form = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    // Nothing validates automatically; `blurJudged` below decides when a
    // judgement is welcome — the same line the address and sign-in steps take.
    mode: "onSubmit",
    reValidateMode: "onSubmit",
  });

  /**
   * Judge a field on the way out of it, but only once there is something to
   * judge. A sign-up form has three fields to tab through, and answering an
   * empty one with "required" tells somebody off for looking around before
   * they have tried anything.
   */
  const blurJudged = (field: keyof SignUpValues) => ({
    onBlur: () => {
      if (form.getValues(field)) void form.trigger(field);
      else form.clearErrors(field);
    },
  });
  const register = api.user.register.useMutation();
  // Sent once the session exists, and deliberately not waited on: confirming
  // the address follows somebody in rather than standing in front of them, so
  // a slow or failing mailer must not hold up the door it is following them
  // through. A send that does not happen is recoverable from inside the app.
  const sendConfirmation =
    api.frontDoor.sendMyAddressConfirmation.useMutation();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [serverErrorIsOnTheForm, setServerErrorIsOnTheForm] = useState(false);
  const [passkeyError, setPasskeyError] = useState<unknown>(null);
  // Whether the password half of the form has opened. Latched rather than
  // derived from focus, so the confirmation does not vanish the moment
  // somebody tabs into it.
  const [isChoosingPassword, setIsChoosingPassword] = useState(false);
  // Only where this deployment mounted the plugin. Offering to create a
  // passkey against an endpoint that was never registered is an offer we
  // cannot honour.
  const publicEnv = usePublicEnv();
  const offersPasskeys = publicEnv.data?.PASSKEYS_ENABLED === true;

  const onSubmit = async (values: SignUpValues) => {
    setSubmitError(null);
    setServerErrorIsOnTheForm(false);
    try {
      await register.mutateAsync({ email, password: values.password });
    } catch (error) {
      // An address that already has an account is a wrong door, not a bad
      // field: the way on is to log in, with the address carried, and the
      // screen says so instead of rejecting the form.
      if (
        onAddressAlreadyRegistered &&
        readHandledError(error)?.code === "email_already_registered"
      ) {
        onAddressAlreadyRegistered();
        return;
      }
      // A rejected field belongs next to that field. Anything the form has no
      // input for falls through to the alert below.
      setServerErrorIsOnTheForm(
        applyHandledErrorToForm({ error, form, hasFormErrorSlot: true }),
      );
      return;
    }

    setIsSigningIn(true);
    let message: string | null = null;
    try {
      const response = await signIn("credentials", {
        email,
        password: values.password,
        callbackUrl,
      });
      message =
        credentialSignInFailure({
          response,
          fallback: ACCOUNT_CREATED_FALLBACK,
        })?.message ?? null;
    } catch {
      message = authFailureMessage({ fallback: ACCOUNT_CREATED_FALLBACK });
    } finally {
      setIsSigningIn(false);
    }

    if (message) {
      setSubmitError(message);
      return;
    }
    rememberLastUsedMethod({ id: "password" });
    // Fire and forget, and swallow: the account is made and the person is
    // signed in, so a mailer that is down is not their problem to solve on
    // this screen.
    sendConfirmation.mutate({});
  };

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={form.handleSubmit(onSubmit)} style={{ width: "100%" }}>
      <VStack width="full" align="stretch" gap="13px">
        {/* Every failure this card can have shows in one place, at the top.

            The marker below is a false positive, not an exemption: the title
            is a string constant and is the only thing that slot can render.
            The raw-message scanner reaches it because `onSubmit` holds a local
            assigned from a `?.message`, and that file-level taint arrives at a
            literal — the identical alerts on the log-in screen, in files
            without such a local, are not flagged. */}
        <HandledErrorAlert
          error={passkeyError}
          fallbackTitle="Could not create a passkey" // no-raw-error-toast-ok
          className="lw-front-door-alert"
        />
        {/* The address this is for, and the way back to change it. It is the
            last chance to notice a typo before it becomes an account. */}
        <EmailPill
          email={email}
          actionLabel="Wrong email?"
          onAction={onUseDifferentEmail}
          testId="signup-identifier"
        />
        {/* Above the password, because it is the better thing to leave with
            and the one most people have never been offered. Beside it rather
            than in front of it: declining has to cost nothing, and here it
            costs a glance — the other way on is already on the screen. */}
        {offersPasskeys ? (
          <>
            <PasskeySignUpButton
              email={email}
              callbackUrl={callbackUrl}
              onError={setPasskeyError}
              onAddressAlreadyRegistered={onAddressAlreadyRegistered}
            />
            <MethodDivider />
          </>
        ) : null}
        {/* Carried in the form as well as shown above it, so a password
            manager saves the pair it was registered with. */}
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
            <Text fontSize="12px" color="fg.muted">
              {PASSWORD_REQUIREMENTS_HINT}
            </Text>
          }
          error={form.formState.errors.password}
        >
          {(id) => (
            <PasswordInput
              id={id}
              autoComplete="new-password"
              registration={form.register("password", {
                ...blurJudged("password"),
                // The second half of the form arrives the moment somebody
                // starts using the first. A manager that fills both fields at
                // once fires this too, so an autofilled sign-up never has to
                // wait for a focus that never happens.
                onChange: () => setIsChoosingPassword(true),
              })}
              onFocus={() => setIsChoosingPassword(true)}
            />
          )}
        </FrontDoorField>
        {/* Confirm and the submit are the SAME decision as typing a password,
            so they arrive with it rather than sitting there first. Four
            stacked things — a passkey, a password, a confirmation and a
            call to action — is a screen that asks somebody to plan before
            they can start; one field is a screen that asks them to begin. */}
        {isChoosingPassword ? (
          <FrontDoorField
            label="Confirm password"
            error={form.formState.errors.confirmPassword}
          >
            {(id) => (
              <PasswordInput
                id={id}
                autoComplete="new-password"
                registration={form.register(
                  "confirmPassword",
                  blurJudged("confirmPassword"),
                )}
              />
            )}
          </FrontDoorField>
        ) : null}
        <FormServerError form={form} />
        {submitError ? (
          <Alert.Root
            status="error"
            borderStartWidth="4px"
            borderStartColor={"frontDoor.danger"}
            color={"frontDoor.danger"}
          >
            <Alert.Content>
              <Alert.Description>{submitError}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        ) : register.error && !serverErrorIsOnTheForm ? (
          <HandledErrorAlert
            error={register.error}
            fallbackTitle="Couldn't create your account"
          />
        ) : null}
        {/* Arrives with the confirmation. Before that the passkey button IS
            the call to action, and a second primary button under an empty
            field only competes with it. */}
        {isChoosingPassword ? (
          <Button
            className="lw-front-door-primary"
            type="submit"
            width="full"
            minHeight="44px"
            marginTop={2}
            fontWeight={600}
            borderRadius={SHAPE.action}
            backgroundColor={"frontDoor.action"}
            color={"frontDoor.onAction"}
            _hover={{ backgroundColor: "frontDoor.actionHover" }}
            loading={register.isPending || isSigningIn}
          >
            Create account
          </Button>
        ) : null}
      </VStack>
    </form>
  );
}
