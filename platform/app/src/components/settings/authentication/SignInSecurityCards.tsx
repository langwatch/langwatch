import {
  Box,
  Button,
  HStack,
  Input,
  RadioGroup,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Lock, LockKeyhole, Timer } from "lucide-react";
import { useState } from "react";
import { SettingsCard } from "~/components/settings/kit/SettingsCard";
import { QuietNotice } from "~/components/settings/QuietNotice";
import { Tooltip } from "~/components/ui/tooltip";
import { useEnterpriseLock } from "~/components/access/useEnterpriseLock";
import type { SignInSecuritySettings } from "./useSignInSecurity";

const OFFERED_ATTEMPTS = 5;
const OFFERED_LOCKOUT_MINUTES = 30;
/** Default idle window; administrators can choose a shorter one. */
const OFFERED_IDLE_MINUTES = 24 * 60;

/**
 * The choices each card offers, in the order somebody weighs them: what
 * happens today first, then the stricter thing they came to consider.
 */
const LOCKOUT_OPTIONS = [
  {
    value: "never",
    label: "Keep letting them try",
    help: "Repeated wrong passwords are still slowed down, but no account is ever locked.",
  },
  {
    value: "lock",
    label: "Lock the account for a while",
    // THE FEAR IS THE THING TO ANSWER. An administrator's reason not to pick
    // this is the worry that it locks their own people out of work they are
    // in the middle of, and it does not: only a new sign-in is refused.
    help: "Only new sign-ins are refused. Nobody already working is signed out, and the lock lifts on its own.",
  },
] as const;

const SESSION_OPTIONS = [
  {
    value: "unbounded",
    label: "Until they sign out",
    help: "A browser left open stays signed in, on any machine, until somebody signs out.",
  },
  {
    value: "bounded",
    label: "End it after a while",
    help: "Someone who walks away is signed out. Anyone still working stays signed in.",
  },
] as const;

const PLAN_EXPLANATION =
  "Setting your own sign-in security rules is part of the Enterprise plan.";

type Lock = ReturnType<typeof useEnterpriseLock>;

/** Why an option will not take, said where there is room to say it. */
function PlanLockLine({ lock }: { lock: Lock }) {
  if (!lock.locked) return null;
  return (
    <HStack gap={2} align="start" data-testid="sign-in-security-plan-notice">
      {/* One pixel down: optically aligned to the line beside it, which
          mathematical alignment always misses. */}
      <Box color="fg.muted" marginTop="1px" flexShrink={0}>
        <Lock size={13} />
      </Box>
      <Text color="fg.muted" fontSize="11.5px" lineHeight="1.55">
        {lock.explanation}
      </Text>
    </HStack>
  );
}

/** One named choice, with what it means underneath it. */
function RuleOption({
  value,
  label,
  help,
  disabled,
  explanation,
  testId,
}: {
  value: string;
  label: string;
  help: string;
  disabled: boolean;
  explanation: string;
  testId: string;
}) {
  return (
    // The tooltip hangs off a wrapper rather than the radio: a disabled
    // control takes no pointer events, so an explanation pinned to it is one
    // nobody can ever read.
    <Tooltip content={explanation} disabled={!disabled}>
      <Box>
        <RadioGroup.Item value={value} disabled={disabled}>
          <RadioGroup.ItemHiddenInput data-testid={testId} />
          <RadioGroup.ItemIndicator />
          <RadioGroup.ItemText>
            <VStack align="start" gap={0}>
              <Text fontSize="13px" fontWeight="500" lineHeight="1.4">
                {label}
              </Text>
              <Text color="fg.muted" fontSize="11.5px" lineHeight="1.5">
                {help}
              </Text>
            </VStack>
          </RadioGroup.ItemText>
        </RadioGroup.Item>
      </Box>
    </Tooltip>
  );
}

/** The whole list of choices, each gated on its own terms. */
function RuleOptions({
  options,
  lock,
  saving,
  gated,
  testIdPrefix,
}: {
  options: readonly { value: string; label: string; help: string }[];
  lock: Lock;
  saving: boolean;
  /** Whether choosing this one needs the plan. */
  gated: (value: string) => boolean;
  testIdPrefix: string;
}) {
  return (
    <VStack align="stretch" gap={3}>
      {options.map((option) => (
        <RuleOption
          key={option.value}
          value={option.value}
          label={option.label}
          help={option.help}
          disabled={saving || (!lock.canTurnOn && gated(option.value))}
          explanation={lock.explanation}
          testId={`${testIdPrefix}-${option.value}`}
        />
      ))}
    </VStack>
  );
}

/** A number somebody types, in a box the size of the number. */
function NumberField({
  label,
  value,
  onChange,
  suffix,
  placeholder,
  hint,
  testId,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  /** The unit, spelled out beside the box rather than appended to the label. */
  suffix: string;
  placeholder?: string;
  hint?: string;
  testId: string;
}) {
  return (
    <VStack align="stretch" gap={1}>
      <Text fontSize="13px" fontWeight="500">
        {label}
      </Text>
      <HStack gap={2}>
        {/* SIZED TO ITS CONTENT. These hold two or three digits; stretched to
            the width of the card they read as a text area somebody forgot to
            fill in. */}
        <Input
          size="sm"
          type="number"
          width="84px"
          value={value === 0 && placeholder !== undefined ? "" : String(value)}
          placeholder={placeholder}
          aria-label={label}
          onChange={(event) => onChange(Number(event.target.value || 0))}
          data-testid={testId}
        />
        <Text fontSize="12px" color="fg.muted" flexShrink={0}>
          {suffix}
        </Text>
      </HStack>
      {hint && (
        <Text color="fg.muted" fontSize="11.5px" lineHeight="1.5">
          {hint}
        </Text>
      )}
    </VStack>
  );
}

function SaveAction({
  changed,
  saving,
  onSave,
  testId,
}: {
  changed: boolean;
  saving: boolean;
  onSave: () => void;
  testId: string;
}) {
  // Absent until there is something to save, rather than present and greyed.
  // A permanently disabled button on a card nobody has touched is furniture.
  if (!changed) return null;
  return (
    <Button
      size="sm"
      colorPalette="orange"
      loading={saving}
      onClick={onSave}
      data-testid={testId}
    >
      Save
    </Button>
  );
}

/**
 * Locking an account after repeated failed sign-ins (GAC-09).
 *
 * The second option's help line spends itself on the fear rather than on the
 * mechanism: an administrator's reason not to choose it is the worry that it
 * will lock their own people out of something they are using right now, and
 * it will not — a lock is earned by wrong passwords and lifts by itself.
 */
export function SignInLockoutCard({
  settings,
  saving,
  onSave,
}: {
  settings: SignInSecuritySettings;
  saving: boolean;
  onSave: (next: SignInSecuritySettings) => void;
}) {
  const [attempts, setAttempts] = useState(settings.lockoutAfterFailedAttempts);
  const [minutes, setMinutes] = useState(
    settings.lockoutMinutes || OFFERED_LOCKOUT_MINUTES,
  );
  const lock = useEnterpriseLock({
    held: false,
    offExplanation: PLAN_EXPLANATION,
    heldExplanation: PLAN_EXPLANATION,
  });
  const locking = attempts > 0;

  const changed =
    attempts !== settings.lockoutAfterFailedAttempts ||
    (locking && minutes !== settings.lockoutMinutes);

  return (
    <SettingsCard
      title="Locking accounts after failed sign-ins"
      // A mark before the name, the way the connection cards carry their
      // protocol's: on a page of cards whose titles are all sentences, it says
      // which one this is before the title is read.
      leading={<LockKeyhole size={14} />}
      hint="What happens when somebody gets their password wrong over and over."
      actions={
        <SaveAction
          changed={changed}
          saving={saving}
          onSave={() =>
            onSave({
              ...settings,
              lockoutAfterFailedAttempts: attempts,
              lockoutMinutes: minutes,
            })
          }
          testId="sign-in-lockout-save"
        />
      }
      data-testid="sign-in-lockout-card"
    >
      <PlanLockLine lock={lock} />

      <RadioGroup.Root
        value={locking ? "lock" : "never"}
        onValueChange={(event) =>
          setAttempts(event.value === "lock" ? OFFERED_ATTEMPTS : 0)
        }
        disabled={saving}
      >
        <RuleOptions
          options={LOCKOUT_OPTIONS}
          lock={lock}
          saving={saving}
          // Only the stricter option is gated. Choosing to keep letting people
          // try is the way back out, and must never be refused.
          gated={(value) => value === "lock" && !locking}
          testIdPrefix="sign-in-lockout"
        />
      </RadioGroup.Root>

      {locking && (
        <VStack align="stretch" gap={3} data-testid="sign-in-lockout-settings">
          <NumberField
            label="Wrong attempts before locking"
            value={attempts}
            onChange={setAttempts}
            suffix="attempts"
            hint="Counted against the address somebody typed, and cleared the moment they get in."
            testId="sign-in-lockout-attempts"
          />
          <NumberField
            label="How long the lock lasts"
            value={minutes}
            onChange={setMinutes}
            suffix="minutes"
            hint="After this they can try again."
            testId="sign-in-lockout-minutes"
          />
        </VStack>
      )}
    </SettingsCard>
  );
}

/** The two numbers, once a limit has been chosen. */
function SessionLimitFields({
  idle,
  maximum,
  onIdle,
  onMaximum,
}: {
  idle: number;
  maximum: number;
  onIdle: (value: number) => void;
  onMaximum: (value: number) => void;
}) {
  return (
    <VStack align="stretch" gap={3} data-testid="session-limit-settings">
      <NumberField
        label="Sign out after inactivity"
        value={idle}
        onChange={onIdle}
        suffix="minutes"
        hint="Using LangWatch keeps a session going; an idle spell ends it."
        testId="session-limit-idle"
      />
      <NumberField
        label="Maximum session length"
        value={maximum}
        onChange={onMaximum}
        suffix="minutes"
        placeholder="None"
        hint="Optional. Ends a session at this age however busy somebody has been."
        testId="session-limit-maximum"
      />
    </VStack>
  );
}

/**
 * Bounding how long a browser session lasts (GAC-10).
 *
 * The card's hint carries the one consequence an administrator must not
 * discover afterwards: saving this ends sessions that are already idle past
 * the new limit, so people are signed out the moment it is saved rather than
 * gradually.
 */
export function SessionLimitCard({
  settings,
  saving,
  onSave,
}: {
  settings: SignInSecuritySettings;
  saving: boolean;
  onSave: (next: SignInSecuritySettings) => void;
}) {
  const [idle, setIdle] = useState(settings.sessionIdleTimeoutMinutes);
  const [maximum, setMaximum] = useState(settings.sessionMaxLifetimeMinutes);
  const lock = useEnterpriseLock({
    held: false,
    offExplanation: PLAN_EXPLANATION,
    heldExplanation: PLAN_EXPLANATION,
  });
  const bounded = idle > 0 || maximum > 0;

  const changed =
    idle !== settings.sessionIdleTimeoutMinutes ||
    maximum !== settings.sessionMaxLifetimeMinutes;

  // A ceiling below the idle window can never be reached by idling, so the
  // idle setting above it would silently do nothing. Said here rather than
  // left to the server's refusal: the two numbers are on screen together and
  // the contradiction is between them, so this is where it is understandable.
  const maximumIsUnreachable = maximum > 0 && maximum < idle;

  return (
    <SettingsCard
      title="How long a session lasts"
      leading={<Timer size={14} />}
      hint="Saving a limit signs out anybody already idle past it."
      actions={
        <SaveAction
          changed={changed && !maximumIsUnreachable}
          saving={saving}
          onSave={() =>
            onSave({
              ...settings,
              sessionIdleTimeoutMinutes: idle,
              sessionMaxLifetimeMinutes: maximum,
            })
          }
          testId="session-limit-save"
        />
      }
      data-testid="session-limit-card"
    >
      <PlanLockLine lock={lock} />

      <RadioGroup.Root
        value={bounded ? "bounded" : "unbounded"}
        onValueChange={(event) => {
          const next = event.value === "bounded";
          setIdle(next ? OFFERED_IDLE_MINUTES : 0);
          if (!next) setMaximum(0);
        }}
        disabled={saving}
      >
        <RuleOptions
          options={SESSION_OPTIONS}
          lock={lock}
          saving={saving}
          gated={(value) => value === "bounded" && !bounded}
          testIdPrefix="session-limit"
        />
      </RadioGroup.Root>

      {maximumIsUnreachable && (
        <QuietNotice
          tone="warning"
          title="A maximum shorter than the inactivity limit would never be reached."
          testId="session-limit-unreachable"
        >
          Everyone would be signed out for inactivity first. Raise the maximum
          above the inactivity limit, or leave it empty.
        </QuietNotice>
      )}

      {bounded && (
        <SessionLimitFields
          idle={idle}
          maximum={maximum}
          onIdle={setIdle}
          onMaximum={setMaximum}
        />
      )}
    </SettingsCard>
  );
}
