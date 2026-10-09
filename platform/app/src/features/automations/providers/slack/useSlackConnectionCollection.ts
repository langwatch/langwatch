import { createListCollection } from "@chakra-ui/react";
import { useMemo } from "react";
import {
  slackConnectionKindLabel,
  slackConnectionScopeLabel,
} from "~/features/automations/components/slack-connection/slackConnectionCopy";
import type { RouterOutputs } from "~/utils/api";

/** One saved connection as the list query returns it. */
export type SlackConnectionListItem =
  RouterOutputs["slackIntegration"]["list"]["connections"][number];

/** The select value that opens connection creation instead of picking one. */
export const NEW_CONNECTION = "__new_slack_connection__";

/** The picker's options: each saved connection, then "New Slack connection" when the reader may create one. */
export function useSlackConnectionCollection({
  connections,
  canCreate,
}: {
  connections: SlackConnectionListItem[] | undefined;
  canCreate: boolean;
}) {
  return useMemo(
    () =>
      createListCollection({
        items: [
          ...(connections ?? []).map((connection) => ({
            value: connection.id,
            label: connection.name,
            detail: `${slackConnectionKindLabel(connection.kind)} · ${slackConnectionScopeLabel(connection.scopeType)}`,
          })),
          ...(canCreate
            ? [
                {
                  value: NEW_CONNECTION,
                  label: "New Slack connection",
                  detail: "",
                },
              ]
            : []),
        ],
      }),
    [connections, canCreate],
  );
}
