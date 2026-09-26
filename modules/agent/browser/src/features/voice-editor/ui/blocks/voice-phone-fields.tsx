import { Field, Input, Text, VStack } from "@chakra-ui/react";
import { Radio, RadioGroup } from "@langwatch/design-system/radio";

import type { CallDirection } from "../../model/voice-form.ts";

/** The phone target's E.164 number, the whole identity of a phone target. */
export function PhoneNumberField({
  phoneNumber,
  onChange,
  invalid,
}: {
  phoneNumber: string;
  onChange: (value: string) => void;
  invalid: boolean;
}) {
  return (
    <Field.Root required invalid={invalid}>
      <Field.Label>Phone number</Field.Label>
      <Input
        value={phoneNumber}
        onChange={(event) => onChange(event.target.value)}
        placeholder="+14155550123"
        data-testid="voice-agent-phone-input"
      />
      <Field.HelperText>
        In E.164 form: a plus sign, the country code, then the number.
      </Field.HelperText>
      {invalid && (
        <Field.ErrorText>Enter the number in E.164 form, like +14155550123</Field.ErrorText>
      )}
    </Field.Root>
  );
}

function DirectionOption({
  value,
  title,
  hint,
}: {
  value: CallDirection;
  title: string;
  hint: string;
}) {
  return (
    <Radio value={value} data-testid={`voice-agent-call-direction-${value}`}>
      <VStack align="start" gap={0}>
        <Text fontSize="sm">{title}</Text>
        <Text fontSize="xs" color="fg.muted">
          {hint}
        </Text>
      </VStack>
    </Radio>
  );
}

/** Which way the call goes: inbound greets on connect, outbound waits for the caller. */
export function CallDirectionField({
  callDirection,
  onChange,
}: {
  callDirection: CallDirection;
  onChange: (value: CallDirection) => void;
}) {
  return (
    <Field.Root>
      <Field.Label>Call direction</Field.Label>
      <RadioGroup
        value={callDirection}
        onValueChange={({ value }: { value: string | null }) => {
          if (value === "inbound" || value === "outbound") onChange(value);
        }}
        data-testid="voice-agent-call-direction"
        size="sm"
      >
        <VStack align="start" gap={2}>
          <DirectionOption
            value="inbound"
            title="Inbound"
            hint="The agent answers calls and greets first."
          />
          <DirectionOption
            value="outbound"
            title="Outbound"
            hint="The agent places calls and waits for the caller to speak first."
          />
        </VStack>
      </RadioGroup>
    </Field.Root>
  );
}
