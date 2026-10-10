import type { SignInSecuritySettings } from "@langwatch/auth-contract";
/**
 * The two sign-in security cards (GAC-09, GAC-10). Presentational: each is
 * handed the saved settings and a save callback, and keeps its own draft.
 */
import {
  Alert,
  Button,
  HStack,
  Input,
  SimpleGrid,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { RawRadioGroup as RadioGroup } from "@langwatch/design-system/radio";
import { useState } from "react";

import { PolicySection } from "../elements/policy-section.tsx";

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

function RuleOptions({
  options,
  testIdPrefix,
}: {
  options: readonly { value: string; label: string; help: string }[];
  testIdPrefix: string;
}) {
  return (
    <VStack align="stretch" gap={0}>
      {options.map((option) => (
        <RadioGroup.Item key={option.value} value={option.value} paddingY={0.5} alignItems="start">
          <RadioGroup.ItemHiddenInput data-testid={`${testIdPrefix}-${option.value}`} />
          <RadioGroup.ItemIndicator marginTop={0.5} />
          <RadioGroup.ItemText>
            <VStack align="start" gap={0}>
              <Text fontSize="xs" fontWeight="medium" lineHeight="short">
                {option.label}
              </Text>
              <Text color="fg.muted" fontSize="xs" lineHeight="short">
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
      <Text fontSize="xs" fontWeight="medium">
        {label}
      </Text>
      <HStack gap={2}>
        <Input
          size="xs"
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
  return (
    <HStack
      width="full"
      gap={3}
      justify="space-between"
      flexWrap="wrap"
      borderTopWidth="1px"
      borderColor="border.muted"
      paddingTop={1.5}
    >
      <Text color="fg.muted" fontSize="xs" flex="1">
        {effect}
      </Text>
      <Button
        size="xs"
        variant="outline"
        loading={saving}
        disabled={!changed}
        onClick={onSave}
        data-testid={testId}
      >
        Save
      </Button>
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
    <PolicySection
      title="Account lockout"
      hint="Protect accounts after repeated failed sign-ins."
      data-testid="sign-in-lockout-card"
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
        aria-label="Account lockout"
        value={locking ? "lock" : "never"}
        onValueChange={(event) => setAttempts(event.value === "lock" ? OFFERED_ATTEMPTS : 0)}
        disabled={saving}
        size="sm"
        colorPalette="gray"
      >
        <RuleOptions options={LOCKOUT_OPTIONS} testIdPrefix="sign-in-lockout" />
      </RadioGroup.Root>

      {locking && (
        <SimpleGrid columns={{ base: 1, md: 2 }} gap={2} data-testid="sign-in-lockout-settings">
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
        </SimpleGrid>
      )}
    </PolicySection>
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
    <PolicySection
      title="Session limits"
      hint="Choose when browser sessions should end."
      data-testid="session-limit-card"
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
        aria-label="Session limits"
        value={bounded ? "bounded" : "unbounded"}
        onValueChange={(event) => {
          const next = event.value === "bounded";
          setIdle(next ? OFFERED_IDLE_MINUTES : 0);
          if (!next) setMaximum(0);
        }}
        disabled={saving}
        size="sm"
        colorPalette="gray"
      >
        <RuleOptions options={SESSION_OPTIONS} testIdPrefix="session-limit" />
      </RadioGroup.Root>

      {maximumIsUnreachable && (
        <Alert.Root size="sm" status="warning" data-testid="session-limit-unreachable">
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
        <SimpleGrid columns={{ base: 1, md: 2 }} gap={2} data-testid="session-limit-settings">
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
        </SimpleGrid>
      )}
    </PolicySection>
  );
}
