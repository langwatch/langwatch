import { Box, Input, Text, VStack } from "@chakra-ui/react";
import type { FormEvent, ReactNode, RefObject } from "react";
import { useState } from "react";
import { HandledErrorAlert } from "~/features/errors";
import { authClient, navigate, safeRedirectTarget } from "~/utils/auth-client";
import { MONO_FONT, SHAPE } from "../authTheme";
import { useFocusWhenSettled } from "../hooks/useFocusWhenSettled";
import { rememberLastUsedMethod } from "../logic/lastUsedMethod";
import {
  endTwoStepChallenge,
  showTwoStepFactor,
  type TwoStepFactor,
} from "../logic/twoStepChallenge";
import { AuthField, FIELD_FOCUS, FIELD_SURFACE } from "./AuthField";
import { AuthPrimaryButton } from "./AuthPrimaryButton";

/** How long an authenticator code is, everywhere it is asked for. */
const AUTHENTICATOR_CODE_LENGTH = 6;

/** The heading the card wears while a challenge is standing. */
export function twoStepChallengeTitle(factor: TwoStepFactor): string {
  return factor === "backup-code"
    ? "Enter a backup code"
    : "Enter your verification code";
}

/**
 * What each box is for, said once, above it.
 *
 * The backup line names what a backup code IS rather than assuming the reader
 * knows: somebody reaching for one is by definition the person whose usual way
 * in has stopped working, often months after they saved the codes somewhere
 * they now have to go and find.
 */
function introFor(factor: TwoStepFactor): string {
  return factor === "backup-code"
    ? "Use one of the single-use codes you saved when you set two-step verification up."
    : "Open your authenticator app and enter the current code for LangWatch.";
}

/**
 * Answering the second factor (D13, ADR-117 §7; the rules underneath are
 * D06's, in specs/identity/mfa-and-session-shape.feature).
 *
 * The card the password was typed into becomes this one. It is the same card,
 * the same field grammar and the same ground, one step further round — because
 * to the person in front of it this is not a new page, it is the same log-in
 * still going on. Before this existed there was no screen at all: a correct
 * password on an enrolled account answered with a challenge nobody asked, and
 * the browser was sent to a page it held no session for.
 *
 * ── The one thing this screen must not become ───────────────────────────
 *
 * An oracle. The swap to the backup-code box is offered to everybody who gets
 * here, whether or not the account holds a single unused code, and the two
 * boxes are refused identically — better-auth distinguishes a wrong
 * authenticator code from a wrong backup code and the boundary collapses both
 * to `identity_mfa_code_invalid` on purpose
 * (`server/better-auth/handled-errors.ts`). So the offer says what is
 * possible, never what is true of this account.
 *
 * Every word of a refusal comes from the code-keyed registry. Nothing here
 * renders a message off the wire: since #5984 that message IS the code slug.
 */
export function TwoStepChallengePanel({
  factor,
  callbackUrl,
}: {
  factor: TwoStepFactor;
  callbackUrl?: string;
}) {
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<unknown>(null);
  // Nothing is judged before submit, the same line every other auth-screen
  // form takes: a rejection is only ever an answer to something somebody wrote.
  const [tooShort, setTooShort] = useState(false);
  const codeField = useFocusWhenSettled();

  const isBackupCode = factor === "backup-code";
  const typed = code.trim();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!answerLooksComplete({ typed, isBackupCode })) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    setRefusal(null);
    setIsSubmitting(true);
    const refused = await verifyCode({ code: typed, isBackupCode });
    setIsSubmitting(false);

    if (refused) {
      setRefusal(refused);
      // The wrong code stays in the box for exactly as long as it takes to
      // read the refusal above it, and no longer: a six-digit code rotates,
      // so the next attempt is a different number and leaving the last one
      // there means clearing it by hand before typing.
      setCode("");
      return;
    }
    rememberLastUsedMethod({ id: "password" });
    endTwoStepChallenge();
    navigate(safeRedirectTarget(callbackUrl));
  };

  return (
    <VStack width="full" align="stretch" gap="14px">
      <Text fontSize="13.5px" lineHeight="1.65" color="fg.muted">
        {introFor(factor)}
      </Text>
      <HandledErrorAlert
        error={refusal}
        fallbackTitle="Couldn't check that code"
        className="lw-auth-alert"
      />
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={onSubmit} style={{ width: "100%" }}>
        <VStack width="full" align="stretch" gap="14px">
          <CodeField
            isBackupCode={isBackupCode}
            code={code}
            isSubmitting={isSubmitting}
            tooShort={tooShort}
            inputRef={codeField}
            onChange={(next) => {
              setCode(next);
              // Typing can lift a rejection, never earn one.
              if (tooShort) setTooShort(false);
            }}
          />
          <VStack width="full" align="stretch" gap="14px" paddingTop="2px">
            <AuthPrimaryButton type="submit" isBusy={isSubmitting}>
              Continue
            </AuthPrimaryButton>
            {/* Always here, for everybody. Whether this account holds a single
                unused backup code is not something the screen knows or would
                say if it did. */}
            <QuietAction
              testId="two-step-swap-factor"
              onClick={() => {
                setCode("");
                setTooShort(false);
                setRefusal(null);
                showTwoStepFactor(
                  isBackupCode ? "authenticator" : "backup-code",
                );
              }}
            >
              {isBackupCode
                ? "Use your authenticator app instead"
                : "Use a backup code instead"}
            </QuietAction>
            <QuietAction
              testId="two-step-cancel"
              onClick={() => endTwoStepChallenge()}
            >
              Cancel and go back
            </QuietAction>
          </VStack>
        </VStack>
      </form>
    </VStack>
  );
}

/**
 * One attempt at the code, and what it was refused with — or null when it went
 * through.
 *
 * The two endpoints are one call from here on purpose. Which of them answered
 * is the thing the screen must never let slip: better-auth tells a wrong
 * authenticator code from a wrong backup code, and the boundary collapses both
 * to `identity_mfa_code_invalid` so that neither the caller nor anybody
 * watching can learn which check they just failed — and with it, whether the
 * account holds backup codes at all.
 *
 * A throw comes back as a plain `Error`, which is the honest answer for one:
 * it is transport rather than a verdict on the code, nothing was named, so
 * nothing is claimed beyond the generic line and a trace identifier.
 */
async function verifyCode({
  code,
  isBackupCode,
}: {
  code: string;
  isBackupCode: boolean;
}): Promise<unknown | null> {
  try {
    const result = isBackupCode
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    return result?.error ?? null;
  } catch (error) {
    return error instanceof Error ? error : new Error("verify failed");
  }
}

/**
 * The one box on this card, in whichever of its two spellings is on screen.
 *
 * Its own component because the box carries a dozen attributes that all say
 * the same thing — this is a short code read off another screen — and inlining
 * them put the panel's own logic a screenful below its own return.
 */
function CodeField({
  isBackupCode,
  code,
  isSubmitting,
  tooShort,
  inputRef,
  onChange,
}: {
  isBackupCode: boolean;
  code: string;
  isSubmitting: boolean;
  tooShort: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (next: string) => void;
}) {
  return (
    <AuthField
      label={isBackupCode ? "Backup code" : "Verification code"}
      error={
        tooShort
          ? {
              type: "manual",
              message: isBackupCode
                ? "Enter one of your backup codes"
                : `Enter the ${AUTHENTICATOR_CODE_LENGTH}-digit code from your authenticator app`,
            }
          : undefined
      }
    >
      {(id) => (
        <Input
          id={id}
          data-testid="two-step-code"
          value={code}
          onChange={(event) => onChange(event.target.value)}
          // 16px on a phone: anything smaller makes iOS zoom the page in when
          // the field takes focus, and it never zooms back out.
          fontSize={{ base: "16px", md: "15px" }}
          minHeight="44px"
          borderRadius={SHAPE.field}
          // The site's technical voice, and the practical reason for it: a
          // code is read one character at a time off another screen, and a
          // proportional face makes a run of digits a blur.
          fontFamily={MONO_FONT}
          letterSpacing={isBackupCode ? "0.08em" : "0.28em"}
          // The keypad on a phone, and the platform's own offer to fill the
          // code straight from a message or an authenticator.
          inputMode={isBackupCode ? "text" : "numeric"}
          autoComplete="one-time-code"
          autoCapitalize={isBackupCode ? "characters" : "none"}
          autoCorrect="off"
          spellCheck={false}
          maxLength={isBackupCode ? 32 : AUTHENTICATOR_CODE_LENGTH}
          placeholder={isBackupCode ? "" : "000000"}
          // Locked while the code is being checked. Attempts here are budgeted
          // — a handful before the account locks — so a second one fired off
          // while the first is still in flight spends one of them for nothing.
          disabled={isSubmitting}
          {...FIELD_SURFACE}
          _focusVisible={FIELD_FOCUS}
          ref={inputRef}
        />
      )}
    </AuthField>
  );
}

/**
 * Whether there is enough typed to be worth sending.
 *
 * A length check and nothing more. It is not a judgement about the code — only
 * the server can make one of those — it is the screen declining to spend one of
 * a small budget of attempts on four digits somebody has not finished typing.
 */
export function answerLooksComplete({
  typed,
  isBackupCode,
}: {
  typed: string;
  isBackupCode: boolean;
}): boolean {
  if (isBackupCode) return typed.length > 0;
  return typed.length === AUTHENTICATOR_CODE_LENGTH;
}

/** The card's quiet secondary lines: a link's weight, a button's job. */
function QuietAction({
  testId,
  onClick,
  children,
}: {
  testId: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Text width="full" textAlign="center" fontSize="13px" color="fg.muted">
      <Box
        asChild
        color="fg"
        fontWeight={600}
        textDecoration="underline"
        textUnderlineOffset="3px"
        textDecorationColor="border"
        _hover={{ textDecorationColor: "fg" }}
      >
        <button type="button" data-testid={testId} onClick={onClick}>
          {children}
        </button>
      </Box>
    </Text>
  );
}
