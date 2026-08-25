import { Alert, Box, Button, Text, VStack } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  PASSWORD_REQUIREMENTS_HINT,
  passwordProblem,
} from "@langwatch/identity";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  applyHandledErrorToForm,
  FormServerError,
  HandledErrorAlert,
  readHandledError,
} from "~/features/errors";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { authFailureMessage } from "~/pages/auth/authFailureMessage";
import { api } from "~/utils/api";
import { signIn } from "~/utils/auth-client";
import { credentialSignInFailure } from "../logic/credentialSignIn";
import { rememberLastUsedMethod } from "../logic/lastUsedMethod";
import "../auth.css";
import { SHAPE } from "../authTheme";
import { EmailPill } from "./EmailPill";
import { AuthField } from "./AuthField";
import { AuthPrimaryButton } from "./AuthPrimaryButton";
import { PasskeySignUpButton } from "./PasskeySignUpButton";
import { PasswordInput } from "./PasswordInput";
import { MethodDivider } from "./SignInMethodPicker";

// No name. Onboarding asks for it, in a place where it is worth asking —
// putting it here charges a field at the one moment somebody has least
// patience for one, to learn something the next screen learns anyway.
//
// The rules come from `@langwatch/identity`, which the mutation behind this
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
 * What happens NEXT depends on whether the address has been confirmed yet,
 * and that is the whole of `addressIsConfirmed` (ADR-117 §6):
 *
 *   - unconfirmed, the ordinary sign-up. The account is created and the
 *     server sends the confirmation link from the same call; nobody is
 *     signed in, because the address is confirmed BEFORE anybody gets in.
 *     The screen becomes "check your email".
 *   - confirmed, which is the link having already come back for an address
 *     that had no account behind it. The proof is in, so this registers and
 *     signs in exactly as it always did.
 *
 * The address is the one typed on the step before and is not asked for again:
 * it rides along in a hidden field so a password manager saves the pair, and
 * cannot be edited here, because the pair being saved has to be the pair that
 * was registered.
 *
 * The password is typed twice and held to a length. That is the ONLY place
 * either happens, on either screen — the log-in form's single
 * `current-password` field never becomes an account's password.
 *
 * A rejection lands on the field that caused it, in words that say what to
 * change. Validation runs on blur in the same words, so most of the time the
 * server never has to answer at all.
 */
export function SignUpCredentialForm({
  email,
  callbackUrl,
  addressIsConfirmed = false,
  addressProof,
  onUseDifferentEmail,
  onAwaitingConfirmation,
  onAddressAlreadyRegistered,
}: {
  email: string;
  callbackUrl: string;
  /**
   * Whether an emailed link has already proved this address. False on the
   * ordinary sign-up, where the link has not been sent yet.
   */
  addressIsConfirmed?: boolean;
  /**
   * The single-use proof of that confirmation, handed over by the link that
   * carried it. Without it the account would be born unconfirmed and mailed a
   * second link for the address it just proved.
   */
  addressProof?: string | null;
  /** Back to the address step, for the address that was typed wrong. */
  onUseDifferentEmail: () => void;
  /**
   * The account exists and its address is not confirmed, so the link is on
   * its way and nobody has been signed in. Required whenever
   * `addressIsConfirmed` is false — the screen has nowhere else to go.
   */
  onAwaitingConfirmation?: (email: string, method: string) => void;
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
  // Registering also SENDS the confirmation link, from the server, on the
  // same call that creates the account (`user.register`). It has to be sent
  // there: sign-up opens no session, so the screen has none to send from, and
  // the only alternative is a public endpoint pointed at any address anybody
  // types.
  const register = api.user.register.useMutation();
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
  // Not on the step a spent link lands on. That step is reached with a
  // single-use proof that only `user.register` can spend, and a passkey does
  // not go through it — the ceremony creates the account itself, which would
  // leave the proof unspent and the address asked for a second time. A passkey
  // is an offer once there is an account to enrol it against (D07).
  const offersPasskeys =
    publicEnv.data?.PASSKEYS_ENABLED === true && !addressIsConfirmed;

  const onSubmit = async (values: SignUpValues) => {
    setSubmitError(null);
    setServerErrorIsOnTheForm(false);
    try {
      await register.mutateAsync({
        email,
        password: values.password,
        addressProof: addressProof ?? void 0,
      });
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

    // The ordinary sign-up ends HERE, one step short of a session. The
    // account exists and the link is on its way to it; opening a session now
    // would be getting in on an address nobody has proved, which is the whole
    // thing this order exists to prevent (ADR-117 §6).
    if (!addressIsConfirmed) {
      rememberLastUsedMethod({ id: "password" });
      onAwaitingConfirmation?.(email, "password");
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
          className="lw-auth-alert"
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
              addressIsConfirmed={addressIsConfirmed}
              onError={setPasskeyError}
              onAwaitingConfirmation={onAwaitingConfirmation}
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
        <AuthField
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
        </AuthField>
        {/* Confirm and the submit are the SAME decision as typing a password,
            so they arrive with it rather than sitting there first. Four
            stacked things — a passkey, a password, a confirmation and a
            call to action — is a screen that asks somebody to plan before
            they can start; one field is a screen that asks them to begin. */}
        {isChoosingPassword ? (
          <AuthField
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
          </AuthField>
        ) : null}
        <FormServerError form={form} />
        {submitError ? (
          <Alert.Root
            status="error"
            borderStartWidth="4px"
            borderStartColor={"auth.danger"}
            color={"auth.danger"}
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
          <Box marginTop={2} width="full">
            <AuthPrimaryButton
              type="submit"
              isBusy={register.isPending || isSigningIn}
            >
              Create account
            </AuthPrimaryButton>
          </Box>
        ) : null}
      </VStack>
    </form>
  );
}
