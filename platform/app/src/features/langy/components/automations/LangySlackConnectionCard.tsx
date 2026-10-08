/**
 * Shown in place of the failure when Langy's Slack automation named no Slack
 * connection. It lists the connections this project can use, read with the
 * viewer's own session, and choosing one answers Langy with its name and id.
 * With none, it opens the Slack connection form on the Automations page;
 * Langy never creates, widens or sees the secret of a connection.
 */
import { Button, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import {
  slackConnectionKindLabel,
  slackConnectionScopeLabel,
} from "~/features/automations/components/slack-connection/slackConnectionCopy";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  type LangySlackConnectionSummary,
  useLangySlackConnections,
} from "../../hooks/useLangyAutomationData";
import { slackConnectionChoiceMessage } from "../../logic/langySlackConnectionPrompt";
import { LangyCapabilityCard } from "../capabilities/LangyCapabilityCard";
import { useLangySend } from "../LangySendContext";
import { LangySpaAnchor } from "../LangySpaAnchor";

/** The Automations page with the Slack connection form open. */
export function addSlackConnectionHref(projectSlug: string): string {
  return `/${projectSlug}/automations?drawer.open=slackConnection`;
}

export function LangySlackConnectionCard({
  reason,
  channel,
}: {
  /** What the automations API said when it refused the save. */
  reason: string | null;
  /** The channel the refused call named, carried into the answer. */
  channel: string | null;
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
      <VStack
        align="stretch"
        gap={2.5}
        data-testid="langy-slack-connection-card"
      >
        {reason ? <RefusalReason reason={reason} /> : null}
        {isLoading ? (
          <Skeleton height="44px" borderRadius="md" />
        ) : hasNone ? (
          <NoConnection canAdd={canAdd} />
        ) : (
          <ConnectionList connections={connections ?? []} channel={channel} />
        )}
        <Text textStyle="xs" color="fg.muted">
          Tokens and webhook URLs stay in the connection. Langy never sees them.
        </Text>
      </VStack>
    </LangyCapabilityCard>
  );
}

function RefusalReason({ reason }: { reason: string }) {
  return (
    <Text
      textStyle="xs"
      color="fg.muted"
      data-testid="langy-slack-refusal-reason"
    >
      The automation wasn't saved: {reason}
    </Text>
  );
}

function ConnectionList({
  connections,
  channel,
}: {
  connections: LangySlackConnectionSummary[];
  channel: string | null;
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
  connection: LangySlackConnectionSummary;
  channel: string | null;
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
          onClick={() =>
            send.send(slackConnectionChoiceMessage({ connection, channel }))
          }
        >
          Use this connection
        </Button>
      ) : null}
    </HStack>
  );
}

function NoConnection({ canAdd }: { canAdd: boolean }) {
  const { project } = useOrganizationTeamProject();
  const href = project?.slug ? addSlackConnectionHref(project.slug) : "";
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
