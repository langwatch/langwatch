import { toaster } from "@langwatch/browser-host/toaster";
import {
  readFieldRefusal,
  readInUseRefusal,
  type SlackConnection,
  type SlackConnectionSaved,
  slackApi,
} from "@langwatch/slack-browser-kit";
import { useState } from "react";

import type { SlackConnectionDraft } from "./use-slack-connection-form-state.ts";

/**
 * Create and update as one save, reporting through the form: a refused secret or scope lands
 * on its field, anything else in the inline alert. Narrowing an organization connection other
 * projects deliver through asks first; a confirmed narrowing resends with `force` (§3).
 */
export function useSaveSlackConnection({
  projectId,
  connection,
  onSaved,
}: {
  projectId: string;
  connection: SlackConnection | undefined;
  onSaved: (saved: SlackConnectionSaved) => void;
}) {
  const utils = slackApi.useUtils();
  const done = ({ saved, title }: { saved: SlackConnectionSaved; title: string }) => {
    void utils.slackIntegration.list.invalidate();
    toaster.create({ type: "success", title });
    onSaved(saved);
  };
  const create = slackApi.slackIntegration.create.useMutation();
  const update = useSlackConnectionUpdate({ projectId, onDone: done });

  const run = (draft: SlackConnectionDraft) => {
    if (connection) {
      update.run({ existing: connection, draft, force: false });
      return;
    }
    const { name, kind, scope, secret } = draft;
    create.mutate(
      { projectId, name, kind, ...scope, secret: secret ?? "" },
      {
        onSuccess: (created) =>
          done({
            saved: { connectionId: created.id, name, kind: created.kind },
            title: "Slack connection added",
          }),
      },
    );
  };

  const error = update.narrowing.length > 0 ? null : (create.error ?? update.error);
  const fieldRefusal = readFieldRefusal(error);
  return {
    run,
    error: Object.keys(fieldRefusal).length > 0 ? null : error,
    fieldRefusal,
    isPending: create.isPending || update.isPending,
    narrowingCounts: update.narrowing.map((pending) => pending.count),
    confirmNarrowing: () => {
      if (connection) update.confirmNarrowing({ existing: connection });
    },
    cancelNarrowing: update.cancelNarrowing,
  };
}

interface PendingNarrowing {
  draft: SlackConnectionDraft;
  count: number;
}

/** The update half: a refusal to narrow holds the draft until confirmed with `force` or dropped. */
function useSlackConnectionUpdate({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: (done: { saved: SlackConnectionSaved; title: string }) => void;
}) {
  const update = slackApi.slackIntegration.update.useMutation();
  const [narrowing, setNarrowing] = useState<PendingNarrowing[]>([]);

  const run = ({
    existing,
    draft,
    force,
  }: {
    existing: SlackConnection;
    draft: SlackConnectionDraft;
    force: boolean;
  }) => {
    const { name, scope, secret } = draft;
    update.mutate(
      { projectId, id: existing.id, name, ...scope, secret, ...(force ? { force: true } : {}) },
      {
        onSuccess: () => {
          setNarrowing([]);
          onDone({
            saved: { connectionId: existing.id, name, kind: existing.kind },
            title: "Slack connection saved",
          });
        },
        onError: (error) => {
          const refusals = force
            ? []
            : readInUseRefusal({ error, fallback: existing.dependentAutomations });
          setNarrowing(refusals.map(({ count }) => ({ draft, count })));
        },
      },
    );
  };

  return {
    run,
    narrowing,
    error: update.error,
    isPending: update.isPending,
    confirmNarrowing: ({ existing }: { existing: SlackConnection }) => {
      const [pending] = narrowing;
      if (pending) run({ existing, draft: pending.draft, force: true });
    },
    cancelNarrowing: () => {
      setNarrowing([]);
      update.reset();
    },
  };
}
