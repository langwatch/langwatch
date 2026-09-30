import { useEffect } from "react";
import { TriggerAction } from "~/generated/prisma/client";
import { api } from "~/utils/api";
import type { AutomationDraft, DraftAction } from "../../logic/draftReducer";

type NamedConnection = { id: string; name: string };

/** The draft with its Slack connection named, or the same draft when there is
 *  nothing to name: not Slack, no connection, already named, or not listed. */
export function withSlackConnectionName({
  draft,
  connections,
}: {
  draft: AutomationDraft;
  connections: ReadonlyArray<NamedConnection> | undefined;
}): AutomationDraft {
  if (draft.action !== TriggerAction.SEND_SLACK_MESSAGE) return draft;
  const slice = draft.slices[TriggerAction.SEND_SLACK_MESSAGE];
  if (!slice.slackIntegrationId || slice.connectionName) return draft;
  const connection = connections?.find(
    (c) => c.id === slice.slackIntegrationId,
  );
  if (!connection) return draft;
  return {
    ...draft,
    slices: {
      ...draft.slices,
      [TriggerAction.SEND_SLACK_MESSAGE]: {
        ...slice,
        connectionName: connection.name,
      },
    },
  };
}

/**
 * Names the draft's Slack connection whenever the list has it, so the review
 * line reads "Slack → <name>" without the Slack step ever opening. Returns the
 * list for hydration to name the draft in the same write when it is cached.
 */
export function useSlackConnectionName({
  projectId,
  draft,
  dispatch,
}: {
  projectId: string;
  draft: AutomationDraft;
  dispatch: (action: DraftAction) => void;
}): ReadonlyArray<NamedConnection> | undefined {
  const slice = draft.slices[TriggerAction.SEND_SLACK_MESSAGE];
  const isSlack =
    draft.action === TriggerAction.SEND_SLACK_MESSAGE &&
    !!slice.slackIntegrationId;
  const list = api.slackIntegration.list.useQuery(
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
