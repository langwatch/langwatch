import { useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";
import { readFieldRefusal, readInUseCount } from "./slackConnectionCopy";
import type {
  SlackConnection,
  SlackConnectionSaved,
} from "./slackConnectionTypes";
import type { SlackConnectionDraft } from "./useSlackConnectionFormState";

/**
 * Create and update as one save, reporting through the form: a refused secret
 * or scope lands on its field, anything else in the inline alert. Narrowing an
 * organization connection other projects deliver through asks first, and a
 * confirmed narrowing resends the update with `force` (ADR-093 §5a).
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
  const utils = api.useUtils();
  const done = (saved: SlackConnectionSaved, title: string) => {
    void utils.slackIntegration.list.invalidate();
    toaster.create({ type: "success", title });
    onSaved(saved);
  };
  const create = api.slackIntegration.create.useMutation();
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
          done(
            { connectionId: created.id, name, kind: created.kind },
            "Slack connection added",
          ),
      },
    );
  };

  const error = update.narrowing ? null : (create.error ?? update.error);
  const fieldRefusal = readFieldRefusal(error);
  return {
    run,
    error: Object.keys(fieldRefusal).length > 0 ? null : error,
    fieldRefusal,
    isPending: create.isPending || update.isPending,
    narrowingCount: update.narrowing?.count ?? null,
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

/** The update half: a refusal to narrow holds the draft until it is confirmed with `force` or dropped. */
function useSlackConnectionUpdate({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: (saved: SlackConnectionSaved, title: string) => void;
}) {
  const update = api.slackIntegration.update.useMutation();
  const [narrowing, setNarrowing] = useState<PendingNarrowing | null>(null);

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
      {
        projectId,
        id: existing.id,
        name,
        ...scope,
        secret,
        ...(force ? { force: true } : {}),
      },
      {
        onSuccess: () => {
          setNarrowing(null);
          onDone(
            { connectionId: existing.id, name, kind: existing.kind },
            "Slack connection saved",
          );
        },
        onError: (error) => {
          const count = readInUseCount({
            error,
            fallback: existing.dependentAutomations,
          });
          if (count !== null && !force) setNarrowing({ draft, count });
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
      if (narrowing) run({ existing, draft: narrowing.draft, force: true });
    },
    cancelNarrowing: () => {
      setNarrowing(null);
      update.reset();
    },
  };
}
