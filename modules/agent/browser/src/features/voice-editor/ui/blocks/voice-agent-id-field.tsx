import { Field, HStack, Input, Link, Text } from "@chakra-ui/react";

/** The credentials line: the key lives on the ElevenLabs provider row, never on the agent. */
function CredentialsLine({
  hasElevenLabsKey,
  addKeyHref,
}: {
  hasElevenLabsKey: boolean;
  addKeyHref: string;
}) {
  if (hasElevenLabsKey) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Using the ElevenLabs provider key
      </Text>
    );
  }
  return (
    <HStack gap={2} fontSize="sm" color="fg.muted">
      <Text>No ElevenLabs key in this project</Text>
      <Link href={addKeyHref} color="blue.fg" data-testid="voice-agent-add-key">
        Add key
      </Link>
    </HStack>
  );
}

/** The ElevenLabs agent id, with the provider-key line beneath it. */
export function ElevenLabsAgentIdField({
  voiceAgentId,
  onChange,
  invalid,
  hasElevenLabsKey,
  addKeyHref,
}: {
  voiceAgentId: string;
  onChange: (value: string) => void;
  invalid: boolean;
  hasElevenLabsKey: boolean;
  addKeyHref: string;
}) {
  return (
    <>
      <Field.Root required invalid={invalid}>
        <Field.Label>Agent id</Field.Label>
        <Input
          value={voiceAgentId}
          onChange={(event) => onChange(event.target.value)}
          placeholder="agent_..."
          data-testid="voice-agent-id-input"
        />
        <Field.HelperText>
          From the ElevenLabs dashboard: Agents, your agent, Agent ID
        </Field.HelperText>
        {invalid && <Field.ErrorText>Agent id is required</Field.ErrorText>}
      </Field.Root>
      <CredentialsLine hasElevenLabsKey={hasElevenLabsKey} addKeyHref={addKeyHref} />
    </>
  );
}
