import { Field, Input, VStack } from "@chakra-ui/react";

import { isValidPhoneNumber, type VoiceForm } from "../../model/voice-form.ts";
import { ElevenLabsAgentIdField } from "./voice-agent-id-field.tsx";
import { CallDirectionField, PhoneNumberField } from "./voice-phone-fields.tsx";
import { VoiceTransportField } from "./voice-transport-field.tsx";

export function VoiceAgentForm({
  form,
  onChange,
  hasTwilioKey,
  hasElevenLabsKey,
  hasAttemptedSubmit,
  addKeyHref,
}: {
  form: VoiceForm;
  onChange: (values: Partial<VoiceForm>) => void;
  hasTwilioKey: boolean;
  hasElevenLabsKey: boolean;
  hasAttemptedSubmit: boolean;
  addKeyHref: string;
}) {
  const nameInvalid = hasAttemptedSubmit && form.name.trim().length === 0;
  return (
    <VStack gap={4} align="stretch" flex={1} overflowY="auto" paddingX={6} paddingY={4}>
      <Field.Root required invalid={nameInvalid}>
        <Field.Label>Name</Field.Label>
        <Input
          value={form.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="Enter agent name"
          data-testid="voice-agent-name-input"
        />
        {nameInvalid && <Field.ErrorText>Name is required</Field.ErrorText>}
      </Field.Root>

      <VoiceTransportField
        transport={form.transport}
        onChange={(transport) => onChange({ transport })}
        hasTwilioKey={hasTwilioKey}
      />

      {form.transport === "phone" ? (
        <>
          <PhoneNumberField
            phoneNumber={form.phoneNumber}
            onChange={(phoneNumber) => onChange({ phoneNumber })}
            invalid={hasAttemptedSubmit && !isValidPhoneNumber(form.phoneNumber)}
          />
          <CallDirectionField
            callDirection={form.callDirection}
            onChange={(callDirection) => onChange({ callDirection })}
          />
        </>
      ) : (
        <ElevenLabsAgentIdField
          voiceAgentId={form.voiceAgentId}
          onChange={(voiceAgentId) => onChange({ voiceAgentId })}
          invalid={hasAttemptedSubmit && form.voiceAgentId.trim().length === 0}
          hasElevenLabsKey={hasElevenLabsKey}
          addKeyHref={addKeyHref}
        />
      )}
    </VStack>
  );
}
