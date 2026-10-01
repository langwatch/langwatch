import { createListCollection } from "@langwatch/design-system/primitives";
import { useMemo } from "react";

import {
  slackConnectionKindLabel,
  slackConnectionScopeLabel,
} from "../../model/slack/slack-connection-copy.ts";
import type { SlackConnection } from "../../model/slack/slack-connection-types.ts";

/** The select value that opens connection creation instead of picking one. */
export const NEW_CONNECTION = "__new_slack_connection__";

/**
 * The picker's options: each saved connection, then "New Slack connection" when the reader may
 * create one.
 */
export function useSlackConnectionCollection({
  connections,
  canCreate,
}: {
  connections: SlackConnection[] | undefined;
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
            ? [{ value: NEW_CONNECTION, label: "New Slack connection", detail: "" }]
            : []),
        ],
      }),
    [connections, canCreate],
  );
}
