import { TriggerAction } from "@langwatch/automation-contract";
import { type NamedSlackConnection, slackApi } from "@langwatch/slack-browser-kit";
import { useEffect } from "react";

import { type SlackNamedDraft, withSlackConnectionName } from "../model/slack-connection-name.ts";
import type { SlackSlice } from "../model/slack-slice.ts";

/**
 * Names the draft's Slack connection whenever the list has it, so the review line reads
 * "Slack → <name>" without the Slack step ever opening. Returns the list so hydration can name
 * the draft in the same write when it is cached.
 */
export function useSlackConnectionName({
  projectId,
  draft,
  dispatch,
}: {
  projectId: string;
  draft: SlackNamedDraft;
  dispatch: (action: {
    type: "SET_SLICE";
    action: typeof TriggerAction.SEND_SLACK_MESSAGE;
    slice: SlackSlice;
  }) => void;
}): readonly NamedSlackConnection[] | undefined {
  const slice = draft.slices[TriggerAction.SEND_SLACK_MESSAGE];
  const isSlack = draft.action === TriggerAction.SEND_SLACK_MESSAGE && !!slice.slackIntegrationId;
  const list = slackApi.slackIntegration.list.useQuery(
    { projectId },
    { enabled: !!projectId && isSlack, refetchOnWindowFocus: false },
  );
  const connections = list.data?.connections;
  useEffect(() => {
    const named = withSlackConnectionName({ draft, connections });
    if (named === draft) return;
    dispatch({
      type: "SET_SLICE",
      action: TriggerAction.SEND_SLACK_MESSAGE,
      slice: named.slices[TriggerAction.SEND_SLACK_MESSAGE],
    });
  }, [draft, connections, dispatch]);
  return connections;
}
