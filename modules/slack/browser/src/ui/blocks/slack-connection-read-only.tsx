import { Field, Text, VStack } from "@chakra-ui/react";
import { ProviderScopeChips } from "@langwatch/authz-browser-kit";
import {
  maskedSecret,
  SLACK_CONNECTION_KINDS,
  type SlackConnection,
  usedByLabel,
} from "@langwatch/slack-browser-kit";

/**
 * A connection the reader may use but not change: everything it says, no inputs, and who can
 * change it.
 */
export function SlackConnectionReadOnly({ connection }: { connection: SlackConnection }) {
  const kind = SLACK_CONNECTION_KINDS.find((candidate) => candidate.value === connection.kind);
  return (
    <VStack align="stretch" gap={4} data-testid="slack-connection-read-only">
      <Field.Root>
        <Field.Label>Type</Field.Label>
        <Text fontSize="sm">{kind?.title ?? connection.kind}</Text>
      </Field.Root>
      <Field.Root>
        <Field.Label>Who can use it</Field.Label>
        <ProviderScopeChips
          scopes={[
            {
              scopeType: connection.scopeType,
              scopeId: connection.scopeId,
              name: connection.scopeName,
            },
          ]}
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>{connection.slackTeamName ? "Workspace" : "Secret"}</Field.Label>
        <Text fontSize="sm">{connection.slackTeamName ?? maskedSecret(connection.secretHint)}</Text>
      </Field.Root>
      <Text fontSize="sm" color="fg.muted">
        {usedByLabel(connection.dependentAutomations)}
      </Text>
      <Text fontSize="sm" color="fg.muted">
        {connection.scopeType === "ORGANIZATION"
          ? "Only an organization admin can change this connection."
          : "Only a project admin can change this connection."}
      </Text>
    </VStack>
  );
}
