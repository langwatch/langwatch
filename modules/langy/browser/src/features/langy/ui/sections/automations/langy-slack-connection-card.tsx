/**
 * In place of the failure when Langy's Slack automation named no connection: the viewer's own
 * connections, one choice answering Langy with its name and id, or slack's `slackConnection`
 * drawer by name when there are none. Langy never creates or sees a connection's secret.
 */
import { Button, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import {
  type SlackConnection,
  slackConnectionKindLabel,
  slackConnectionScopeLabel,
} from "@langwatch/slack-browser-kit";

import { useOrganizationTeamProject } from "../../../../../behavior/use-organization-team-project.ts";
import { useLangySlackConnections } from "../../../behavior/use-langy-automation-data.ts";
import { slackConnectionChoiceMessage } from "../../../model/logic/langy-slack-connection-prompt.ts";
import { LangyCapabilityCard } from "../capabilities/langy-capability-card.tsx";
import { useLangySend } from "../langy-send-context.tsx";
import { LangySpaAnchor } from "../langy-spa-anchor.tsx";

/** The Automations page with slack's connection drawer open. */
export function addSlackConnectionHref({ projectSlug }: { projectSlug: string }): string {
  return `/${projectSlug}/automations?drawer.open=slackConnection`;
}

export function LangySlackConnectionCard({
  reason,
  channel,
}: {
  /** What the automations API said when it refused the save. */
  reason: string | undefined;
  /** The channel the refused call named, carried into the answer. */
  channel: string | undefined;
}) {
  const { connections, canAdd, isLoading } = useLangySlackConnections();
  const hasNone = !isLoading && (connections?.length ?? 0) === 0;
  return (
    <LangyCapabilityCard
      tone="read"
      surface="automations"
      overline="Slack connection"
      deepLink={false}
      title={
        hasNone
          ? "This project has no Slack connection yet"
          : "Pick the Slack connection to post through"
      }
    >
      <VStack align="stretch" gap={2.5} data-testid="langy-slack-connection-card">
        {reason ? (
          <Text textStyle="xs" color="fg.muted" data-testid="langy-slack-refusal-reason">
            The automation wasn't saved: {reason}
          </Text>
        ) : null}
        <ConnectionChoice
          isLoading={isLoading}
          hasNone={hasNone}
          canAdd={canAdd}
          connections={connections ?? []}
          channel={channel}
        />
        <Text textStyle="xs" color="fg.muted">
          Tokens and webhook URLs stay in the connection. Langy never sees them.
        </Text>
      </VStack>
    </LangyCapabilityCard>
  );
}

function ConnectionChoice({
  isLoading,
  hasNone,
  canAdd,
  connections,
  channel,
}: {
  isLoading: boolean;
  hasNone: boolean;
  canAdd: boolean;
  connections: SlackConnection[];
  channel: string | undefined;
}) {
  if (isLoading) return <Skeleton height="44px" borderRadius="md" />;
  if (hasNone) return <NoConnection canAdd={canAdd} />;
  return <ConnectionList connections={connections} channel={channel} />;
}

function ConnectionList({
  connections,
  channel,
}: {
  connections: SlackConnection[];
  channel: string | undefined;
}) {
  return (
    <VStack
      align="stretch"
      gap={0}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      overflow="hidden"
    >
      {connections.map((connection, index) => (
        <ConnectionRow
          key={connection.id}
          connection={connection}
          channel={channel}
          divided={index > 0}
        />
      ))}
    </VStack>
  );
}

function ConnectionRow({
  connection,
  channel,
  divided,
}: {
  connection: SlackConnection;
  channel: string | undefined;
  divided: boolean;
}) {
  const send = useLangySend();
  return (
    <HStack
      gap={2}
      paddingX={2.5}
      paddingY={2}
      borderTopWidth={divided ? "1px" : 0}
      borderColor="border.muted"
      background="bg"
      data-testid="langy-slack-connection-row"
    >
      <VStack align="stretch" gap={0} flex={1} minWidth={0}>
        <Text textStyle="sm" fontWeight="medium" color="fg" truncate>
          {connection.name}
        </Text>
        <Text textStyle="xs" color="fg.muted">
          {slackConnectionKindLabel(connection.kind)} ·{" "}
          {slackConnectionScopeLabel(connection.scopeType)}
        </Text>
      </VStack>
      {send ? (
        <Button
          size="xs"
          variant="outline"
          disabled={send.isTurnInFlight}
          onClick={() => send.send(slackConnectionChoiceMessage({ connection, channel }))}
        >
          Use this connection
        </Button>
      ) : null}
    </HStack>
  );
}

function NoConnection({ canAdd }: { canAdd: boolean }) {
  const { project } = useOrganizationTeamProject();
  const href = project?.slug ? addSlackConnectionHref({ projectSlug: project.slug }) : "";
  return (
    <VStack align="stretch" gap={2}>
      <Text textStyle="sm">
        {canAdd
          ? "Add one on the Automations page with a bot token or an incoming webhook, then pick it here. By default it is shared with this project only."
          : "Ask someone who can manage this project to add a Slack connection, then pick it here."}
      </Text>
      {canAdd && href ? (
        <Button asChild size="xs" variant="outline" alignSelf="flex-start">
          <LangySpaAnchor href={href} data-testid="langy-add-slack-connection">
            Add a Slack connection
          </LangySpaAnchor>
        </Button>
      ) : null}
    </VStack>
  );
}
