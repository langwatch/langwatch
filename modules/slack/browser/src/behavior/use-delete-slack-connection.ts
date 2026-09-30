import { showErrorToast } from "@langwatch/browser-host/errors";
import { toaster } from "@langwatch/browser-host/toaster";
import { type SlackConnection } from "@langwatch/slack-browser-kit";
import { useState } from "react";

import { readInUseRefusal, type SlackConnectionInUse } from "../model/slack-connection-refusals.ts";
import { slackApi } from "./slack-api.ts";

/**
 * Deletes one connection. A connection automations still claim is refused (409
 * `slack_connection_in_use`, §3): the refusal's claimants are kept for the drawer to name and
 * the connection stays. There is no forced delete.
 */
export function useDeleteSlackConnection({
  projectId,
  connection,
  onDeleted,
}: {
  projectId: string;
  connection: SlackConnection;
  onDeleted: () => void;
}) {
  const utils = slackApi.useUtils();
  const remove = slackApi.slackIntegration.delete.useMutation();
  const [refusals, setRefusals] = useState<SlackConnectionInUse[]>([]);

  const run = () =>
    remove.mutate(
      { projectId, id: connection.id },
      {
        onSuccess: () => {
          setRefusals([]);
          void utils.slackIntegration.list.invalidate();
          toaster.create({ type: "success", title: "Slack connection deleted" });
          onDeleted();
        },
        onError: (error) => {
          const inUse = readInUseRefusal({ error, fallback: connection.dependentAutomations });
          setRefusals(inUse);
          if (inUse.length === 0) {
            showErrorToast({ error, fallbackTitle: "Couldn't delete the Slack connection" });
          }
        },
      },
    );

  return { run, isPending: remove.isPending, refusals };
}
