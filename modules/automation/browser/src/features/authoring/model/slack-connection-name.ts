import { TriggerAction } from "@langwatch/automation-contract";

import {
  findSlackConnection,
  type NamedSlackConnection,
} from "../../../model/slack/slack-connection-name.ts";
import type { SlackSlice } from "./slack-slice.ts";

/** The part of a draft the Slack connection name is read from and written to. */
export interface SlackNamedDraft {
  action: TriggerAction | null;
  slices: { [TriggerAction.SEND_SLACK_MESSAGE]: SlackSlice };
}

/** The draft with its Slack connection named, or the same draft when there is nothing to
 *  name: not Slack, no connection, already named, or not listed. */
export function withSlackConnectionName<D extends SlackNamedDraft>({
  draft,
  connections,
}: {
  draft: D;
  connections: readonly NamedSlackConnection[] | undefined;
}): D {
  if (draft.action !== TriggerAction.SEND_SLACK_MESSAGE) return draft;
  const slice = draft.slices[TriggerAction.SEND_SLACK_MESSAGE];
  if (!slice.slackIntegrationId || slice.connectionName) return draft;
  const [connection] = findSlackConnection({
    connectionId: slice.slackIntegrationId,
    connections,
  });
  if (!connection) return draft;
  return {
    ...draft,
    slices: {
      ...draft.slices,
      [TriggerAction.SEND_SLACK_MESSAGE]: { ...slice, connectionName: connection.name },
    },
  };
}
