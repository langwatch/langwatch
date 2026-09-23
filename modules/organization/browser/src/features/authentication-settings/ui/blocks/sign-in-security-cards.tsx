/**
 * The two sign-in security cards (GAC-09, GAC-10). Presentational: each is
 * handed the saved settings and a save callback, and keeps its own draft.
 */
import {
  Alert,
  Button,
  Card,
  Heading,
  HStack,
  Input,
  RadioGroup,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { SignInSecuritySettings } from "@langwatch/auth-contract";
import { LockKeyhole, Timer } from "lucide-react";
import { useState, type ReactNode } from "react";

const OFFERED_ATTEMPTS = 5;
const OFFERED_LOCKOUT_MINUTES = 30;
/** The service's default idle window in minutes. */
const OFFERED_IDLE_MINUTES = 24 * 60;

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

type CardProps = {
  settings: SignInSecuritySettings;
  saving: boolean;
  onSave: (next: SignInSecuritySettings) => void;
};

function PolicyCard({
  title,
  hint,
  leading,
  actions,
  testId,
  children,
}: {
  title: string;
  hint: string;
  leading: ReactNode;
  actions: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Card.Root width="full" data-testid={testId}>
      <Card.Body>
        <VStack align="stretch" gap={3}>
          <VStack align="start" gap={0.5}>
            <HStack gap={2}>
              {leading}
              <Heading size="sm">{title}</Heading>
            </HStack>
            <Text fontSize="xs" color="fg.muted">
              {hint}
            </Text>
          </VStack>
          {children}
          {actions}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

function RuleOptions({
  options,
  testIdPrefix,
}: {
  options: readonly { value: string; label: string; help: string }[];
  testIdPrefix: string;
}) {
  return (
    <VStack align="stretch" gap={3}>
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          paddingX={2.5}
          paddingY={2}
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
        >
          <RadioGroup.ItemHiddenInput data-testid={`${testIdPrefix}-${option.value}`} />
          <RadioGroup.ItemIndicator />
          <RadioGroup.ItemText>
            <VStack align="start" gap={0}>
              <Text fontSize="13px" fontWeight="500">
                {option.label}
              </Text>
              <Text color="fg.muted" fontSize="11.5px">
                {option.help}
              </Text>
            </VStack>
          </RadioGroup.ItemText>
        </RadioGroup.Item>
      ))}
    </VStack>
  );
}

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
  suffix: string;
  placeholder?: string;
  hint: string;
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
        <Text fontSize="12px" color="fg.muted">
          {suffix}
        </Text>
      </HStack>
      <Text color="fg.muted" fontSize="11.5px">
        {hint}
      </Text>
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
    <HStack gap={2} flexWrap="wrap">
      <Button
        size="sm"
        colorPalette="orange"
        loading={saving}
        onClick={onSave}
        data-testid={testId}
      >
        Save
      </Button>
      <Text color="fg.muted" fontSize="11.5px">
        {effect}
      </Text>
    </HStack>
  );
}

/** Lock an account after repeated failed sign-ins (GAC-09). */
export function SignInLockoutCard({ settings, saving, onSave }: CardProps) {
  const [attempts, setAttempts] = useState(settings.lockoutAfterFailedAttempts);
  const [minutes, setMinutes] = useState(settings.lockoutMinutes || OFFERED_LOCKOUT_MINUTES);
  const locking = attempts > 0;
  const changed =
    attempts !== settings.lockoutAfterFailedAttempts ||
    (locking && minutes !== settings.lockoutMinutes);

  return (
    <PolicyCard
      title="Account lockout"
      hint="Protect accounts after repeated failed sign-ins."
      leading={<LockKeyhole size={14} />}
      testId="sign-in-lockout-card"
      actions={
        <SaveAction
          changed={changed}
          saving={saving}
          onSave={() =>
            onSave({ ...settings, lockoutAfterFailedAttempts: attempts, lockoutMinutes: minutes })
          }
          effect="Applies to new sign-ins."
          testId="sign-in-lockout-save"
        />
      }
    >
      <RadioGroup.Root
        value={locking ? "lock" : "never"}
        onValueChange={(event) => setAttempts(event.value === "lock" ? OFFERED_ATTEMPTS : 0)}
        disabled={saving}
      >
        <RuleOptions options={LOCKOUT_OPTIONS} testIdPrefix="sign-in-lockout" />
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
    </PolicyCard>
  );
}

/** Bound how long a browser session lasts (GAC-10). */
export function SessionLimitCard({ settings, saving, onSave }: CardProps) {
  const [idle, setIdle] = useState(settings.sessionIdleTimeoutMinutes);
  const [maximum, setMaximum] = useState(settings.sessionMaxLifetimeMinutes);
  const bounded = idle > 0 || maximum > 0;
  const changed =
    idle !== settings.sessionIdleTimeoutMinutes || maximum !== settings.sessionMaxLifetimeMinutes;
  const maximumIsUnreachable = maximum > 0 && maximum < idle;

  return (
    <PolicyCard
      title="Session limits"
      hint="Choose when browser sessions should end."
      leading={<Timer size={14} />}
      testId="session-limit-card"
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
    >
      <RadioGroup.Root
        value={bounded ? "bounded" : "unbounded"}
        onValueChange={(event) => {
          const next = event.value === "bounded";
          setIdle(next ? OFFERED_IDLE_MINUTES : 0);
          if (!next) setMaximum(0);
        }}
        disabled={saving}
      >
        <RuleOptions options={SESSION_OPTIONS} testIdPrefix="session-limit" />
      </RadioGroup.Root>

      {maximumIsUnreachable && (
        <Alert.Root status="warning" data-testid="session-limit-unreachable">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              A maximum shorter than the inactivity limit would never be reached.
            </Alert.Title>
            <Alert.Description>
              Everyone would be signed out for inactivity first. Raise the maximum above the
              inactivity limit, or leave it empty.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      {bounded && (
        <VStack align="stretch" gap={3} data-testid="session-limit-settings">
          <NumberField
            label="Idle timeout"
            value={idle}
            onChange={setIdle}
            suffix="minutes"
            hint="Ends sessions after this many inactive minutes."
            testId="session-limit-idle"
          />
          <NumberField
            label="Maximum session length"
            value={maximum}
            onChange={setMaximum}
            suffix="minutes"
            placeholder="No limit"
            hint="Optional. Ends the session at this age, even with activity."
            testId="session-limit-maximum"
          />
        </VStack>
      )}
    </PolicyCard>
  );
}
