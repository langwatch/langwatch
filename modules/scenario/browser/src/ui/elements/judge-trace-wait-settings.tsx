/**
 * The collapsed "Advanced judge settings" section: how long the judge waits for the agent's
 * trace, in seconds. Blank inputs follow the project's recommendation.
 * @see specs/scenarios/judge-trace-wait-settings.feature
 */

import {
  Box,
  Collapsible,
  Grid,
  HStack,
  Input,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import {
  DEFAULT_QUIET_PERIOD_SECONDS,
  DEFAULT_TRACE_WAIT_SECONDS,
  hasJudgeTraceWait,
  type JudgeTraceWaitErrors,
  type JudgeTraceWaitInput,
} from "../../model/judge-trace-wait.ts";

const FIELD_STYLE = {
  borderRadius: "lg",
  borderWidth: "1px",
  background: "bg.panel",
  textStyle: "bodySm",
} as const;

function SecondsField({
  label,
  helper,
  placeholder,
  value,
  error,
  onChange,
}: {
  label: string;
  helper: string;
  placeholder: number;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <VStack align="stretch" gap={1}>
      <Text as="label" textStyle="caption" fontWeight="medium" color="fg.muted">
        {label}
        <Input
          {...FIELD_STYLE}
          marginTop={1}
          size="sm"
          type="number"
          inputMode="decimal"
          min={0}
          aria-label={label}
          placeholder={String(placeholder)}
          value={value}
          borderColor={error ? "red.fg" : "border"}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      </Text>
      <Text textStyle="micro" color={error ? "red.fg" : "fg.muted"}>
        {error ?? helper}
      </Text>
    </VStack>
  );
}

export function JudgeTraceWaitSettings({
  value,
  errors = {},
  onChange,
}: {
  value: JudgeTraceWaitInput;
  errors?: JudgeTraceWaitErrors;
  onChange: (value: JudgeTraceWaitInput) => void;
}) {
  // Null until the person toggles it: the section then follows whether anything is set.
  const [open, setOpen] = useState<boolean | null>(null);
  const isOpen = (open ?? hasJudgeTraceWait(value)) || !!errors.quietPeriod || !!errors.waitTimeout;

  return (
    <Collapsible.Root open={isOpen} onOpenChange={(details) => setOpen(details.open)} width="full">
      <Collapsible.Trigger asChild>
        <HStack
          cursor="pointer"
          gap={1.5}
          color="fg.muted"
          textStyle="caption"
          fontWeight="medium"
          data-testid="judge-trace-wait-toggle"
        >
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Advanced judge settings
        </HStack>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <Box paddingTop={2}>
          <Grid templateColumns="1fr 1fr" gap={3} data-testid="judge-trace-wait-settings">
            <SecondsField
              label="Quiet period"
              helper="Seconds the trace must stay unchanged before judging"
              placeholder={DEFAULT_QUIET_PERIOD_SECONDS}
              value={value.quietPeriodSeconds}
              error={errors.quietPeriod}
              onChange={(quietPeriodSeconds) => onChange({ ...value, quietPeriodSeconds })}
            />
            <SecondsField
              label="Max trace wait"
              helper="Seconds to wait for the agent's spans"
              placeholder={DEFAULT_TRACE_WAIT_SECONDS}
              value={value.waitTimeoutSeconds}
              error={errors.waitTimeout}
              onChange={(waitTimeoutSeconds) => onChange({ ...value, waitTimeoutSeconds })}
            />
          </Grid>
        </Box>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
