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
import { useEnterpriseLock } from "~/components/access/useEnterpriseLock";
import { SettingsCard } from "~/components/settings/kit/SettingsCard";
import { QuietNotice } from "~/components/settings/QuietNotice";
import { Tooltip } from "~/components/ui/tooltip";
import type { SignInSecuritySettings } from "./useSignInSecurity";

const OFFERED_ATTEMPTS = 5;
const OFFERED_LOCKOUT_MINUTES = 30;
/** The service's default idle window in minutes. */
const OFFERED_IDLE_MINUTES = 24 * 60;

/** Choices for the lockout and session policy cards. */
const LOCKOUT_OPTIONS = [
  {
    value: "never",
    label: "Rate limiting only",
    help: "Failed sign-ins are slowed down, but accounts are not locked.",
  },
  {
    value: "lock",
    label: "Temporary lockout",
    help: "Repeated failures lock an account for a set time.",
  },
] as const;

const SESSION_OPTIONS = [
  {
    value: "unbounded",
    label: "Default session limits",
    help: "Sessions follow the standard 30-day rolling sign-in policy.",
  },
  {
    value: "bounded",
    label: "Custom session limits",
    help: "Set an idle timeout and an optional maximum lifetime.",
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
    // A disabled radio cannot receive pointer events, so the tooltip wraps it.
    <Tooltip content={explanation} disabled={!disabled}>
      <Box>
        <RadioGroup.Item
          value={value}
          disabled={disabled}
          paddingX={2.5}
          paddingY={2}
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          background="bg.panel"
          transition="background 0.15s ease, border-color 0.15s ease"
          _checked={{
            borderColor: "colorPalette.solid",
            background: "colorPalette.subtle",
          }}
          _hover={{ borderColor: "border.emphasized" }}
        >
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

/** Render choices with their individual plan gates. */
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
  /** Whether choosing this value needs the plan. */
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

/** A numeric setting with its stored unit shown beside the input. */
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
  effect,
  testId,
}: {
  changed: boolean;
  saving: boolean;
  onSave: () => void;
  effect: string;
  testId: string;
}) {
  if (!changed) return null;
  return (
    <HStack gap={2} align="center" flexWrap="wrap">
      <Button
        size="sm"
        colorPalette="orange"
        loading={saving}
        onClick={onSave}
        data-testid={testId}
      >
        Save
      </Button>
      <Text color="fg.muted" fontSize="11.5px" lineHeight="1.5">
        {effect}
      </Text>
    </HStack>
  );
}

/** Lock an account after repeated failed sign-ins (GAC-09). */
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
      title="Account lockout"
      leading={<LockKeyhole size={14} />}
      hint="Protect accounts after repeated failed sign-ins."
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
          effect="Applies to new sign-ins."
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
          gated={(value) => value === "lock" && !locking}
          testIdPrefix="sign-in-lockout"
        />
      </RadioGroup.Root>

      {locking && (
        <VStack align="stretch" gap={3} data-testid="sign-in-lockout-settings">
          <NumberField
            label="Failed sign-ins before lock"
            value={attempts}
            onChange={setAttempts}
            suffix="attempts"
            hint="The count resets after a successful sign-in."
            testId="sign-in-lockout-attempts"
          />
          <NumberField
            label="Lock duration"
            value={minutes}
            onChange={setMinutes}
            suffix="minutes"
            hint="New sign-ins are allowed again after this time."
            testId="sign-in-lockout-minutes"
          />
        </VStack>
      )}
    </SettingsCard>
  );
}

/** Session timeout fields shown for the custom policy. */
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
        label="Idle timeout"
        value={idle}
        onChange={onIdle}
        suffix="minutes"
        hint="Ends sessions after this many inactive minutes."
        testId="session-limit-idle"
      />
      <NumberField
        label="Maximum session length"
        value={maximum}
        onChange={onMaximum}
        suffix="minutes"
        placeholder="No limit"
        hint="Optional. Ends the session at this age, even with activity."
        testId="session-limit-maximum"
      />
    </VStack>
  );
}

/** Bound browser session duration (GAC-10). */
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

  const maximumIsUnreachable = maximum > 0 && maximum < idle;

  return (
    <SettingsCard
      title="Session limits"
      leading={<Timer size={14} />}
      hint="Choose when browser sessions should end."
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
          effect="Saving signs out sessions already past the new limit."
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
