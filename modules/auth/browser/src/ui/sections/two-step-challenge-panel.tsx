import { Box, Button, Input, Text, VStack } from "@langwatch/design-system/primitives";
import type { FormEvent, ReactNode, RefObject } from "react";
import { useState } from "react";

import { navigate, safeRedirectTarget } from "../../behavior/auth-client.tsx";
import { verifyUiTwoStepChallenge } from "../../behavior/ui-two-factor.ts";
import { useFocusWhenSettled } from "../../behavior/use-focus-when-settled.ts";
import { MONO_FONT, SHAPE } from "../../model/front-door-theme.ts";
import { rememberLastUsedMethod } from "../../model/last-used-method.ts";
import {
  endTwoStepChallenge,
  showTwoStepFactor,
  type TwoStepFactor,
} from "../../model/two-step-challenge.ts";
import { FIELD_FOCUS, FIELD_SURFACE, FrontDoorField } from "../elements/front-door-field.tsx";
import { HandledErrorAlert } from "../elements/handled-error-alert.tsx";

/** How long an authenticator code is, everywhere it is asked for. */
const AUTHENTICATOR_CODE_LENGTH = 6;

/** The heading the card wears while a challenge is standing. */
export function twoStepChallengeTitle({ factor }: { factor: TwoStepFactor }): string {
  return factor === "backup-code" ? "Enter a backup code" : "Enter your verification code";
}

function introFor(factor: TwoStepFactor): string {
  return factor === "backup-code"
    ? "Use one of the single-use codes you saved when you set two-step verification up."
    : "Open your authenticator app and enter the current code for LangWatch.";
}

/**
 * Answering the second factor (D13, ADR-117 §7; D06). The password's card
 * becomes this one. The backup-code swap is offered to everybody and both
 * boxes are refused identically, so nothing is said about the account.
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
  // Nothing is judged before submit: a rejection answers something written.
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
    const answer = await verifyCode({ code: typed, isBackupCode });
    setIsSubmitting(false);

    if (!answer.ok) {
      setRefusal(answer.error);
      // A code rotates, so the next attempt is a different number.
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
        className="lw-front-door-alert"
      />
      <form onSubmit={(event) => void onSubmit(event)} style={{ width: "100%" }}>
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
            <Button type="submit" colorPalette="orange" loading={isSubmitting}>
              Continue
            </Button>
            <QuietAction
              testId="two-step-swap-factor"
              onClick={() => {
                setCode("");
                setTooShort(false);
                setRefusal(null);
                showTwoStepFactor({ factor: isBackupCode ? "authenticator" : "backup-code" });
              }}
            >
              {isBackupCode ? "Use your authenticator app instead" : "Use a backup code instead"}
            </QuietAction>
            <QuietAction testId="two-step-cancel" onClick={() => endTwoStepChallenge()}>
              Cancel and go back
            </QuietAction>
          </VStack>
        </VStack>
      </form>
    </VStack>
  );
}

/** One attempt; a throw is transport, not a verdict, so it names nothing. */
async function verifyCode({ code, isBackupCode }: { code: string; isBackupCode: boolean }) {
  try {
    return await verifyUiTwoStepChallenge({ code, isBackupCode });
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error : new Error("verify failed"),
    };
  }
}

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
    <FrontDoorField
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
          // 16px on a phone, or iOS zooms in on focus and never zooms out.
          fontSize={{ base: "16px", md: "15px" }}
          minHeight="44px"
          borderRadius={SHAPE.field}
          // A code is read one character at a time off another screen.
          fontFamily={MONO_FONT}
          letterSpacing={isBackupCode ? "0.08em" : "0.28em"}
          inputMode={isBackupCode ? "text" : "numeric"}
          autoComplete="one-time-code"
          autoCapitalize={isBackupCode ? "characters" : "none"}
          autoCorrect="off"
          spellCheck={false}
          maxLength={isBackupCode ? 32 : AUTHENTICATOR_CODE_LENGTH}
          placeholder={isBackupCode ? "" : "000000"}
          // Attempts are budgeted; a second one in flight spends one for nothing.
          disabled={isSubmitting}
          {...FIELD_SURFACE}
          _focusVisible={FIELD_FOCUS}
          ref={inputRef}
        />
      )}
    </FrontDoorField>
  );
}

/** A length check only: declines to spend an attempt on an unfinished code. */
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
