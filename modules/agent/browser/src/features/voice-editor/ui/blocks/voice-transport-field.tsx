import { Field, Link, NativeSelect } from "@chakra-ui/react";
import type { VoiceTransport } from "@langwatch/agent-contract";

import { isVoiceTransport } from "../../model/voice-form.ts";
import { MODEL_PROVIDERS_ROUTE, transportOptionsFor } from "../../model/voice-talk.ts";

/** "Reached via": every transport listed; phone gated on a Twilio provider. */
export function VoiceTransportField({
  transport,
  onChange,
  hasTwilioKey,
}: {
  transport: VoiceTransport;
  onChange: (value: VoiceTransport) => void;
  hasTwilioKey: boolean;
}) {
  const options = transportOptionsFor({ hasTwilioKey, transport });
  return (
    <Field.Root>
      <Field.Label>Reached via</Field.Label>
      <NativeSelect.Root>
        <NativeSelect.Field
          value={transport}
          onChange={(event) => {
            if (isVoiceTransport(event.target.value)) onChange(event.target.value);
          }}
          data-testid="voice-agent-transport-select"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      {!hasTwilioKey && transport !== "phone" && (
        <Field.HelperText data-testid="voice-agent-phone-hint">
          To reach an agent by phone, add Twilio in Settings &gt;{" "}
          <Link
            href={MODEL_PROVIDERS_ROUTE}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="voice-agent-model-providers-link"
          >
            Model Providers
          </Link>
          .
        </Field.HelperText>
      )}
    </Field.Root>
  );
}
