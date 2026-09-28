import { Button } from "@chakra-ui/react";
import { useState } from "react";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import {
  inUseDeleteConfirmation,
  readInUseCount,
  unusedDeleteConfirmation,
} from "./slackConnectionCopy";
import type { SlackConnection } from "./slackConnectionTypes";

type Confirming = { kind: "unused" } | { kind: "inUse"; count: number };

/**
 * Every delete confirms. A connection the list says is unused asks first,
 * then deletes without force; one automations deliver through is refused
 * with the count, and only then does the reader confirm that those
 * automations stop delivering (ADR-093 §5a).
 */
export function DeleteSlackConnectionButton({
  projectId,
  connection,
  onDeleted,
}: {
  projectId: string;
  connection: SlackConnection;
  onDeleted: () => void;
}) {
  const utils = api.useUtils();
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const remove = api.slackIntegration.delete.useMutation();

  const runDelete = ({ force }: { force: boolean }) =>
    remove.mutate(
      { projectId, id: connection.id, ...(force ? { force: true } : {}) },
      {
        onSuccess: () => {
          setConfirming(null);
          void utils.slackIntegration.list.invalidate();
          toaster.create({
            type: "success",
            title: "Slack connection deleted",
          });
          onDeleted();
        },
        onError: (error) => {
          const count = readInUseCount({
            error,
            fallback: connection.dependentAutomations,
          });
          if (count !== null && !force) {
            setConfirming({ kind: "inUse", count });
            return;
          }
          showErrorToast({
            error,
            fallbackTitle: "Couldn't delete the Slack connection",
          });
        },
      },
    );

  const confirmation =
    confirming?.kind === "inUse"
      ? inUseDeleteConfirmation({
          name: connection.name,
          count: confirming.count,
        })
      : unusedDeleteConfirmation({ name: connection.name });

  return (
    <>
      <Button
        variant="outline"
        colorPalette="red"
        loading={remove.isPending && confirming === null}
        onClick={() =>
          connection.dependentAutomations > 0
            ? runDelete({ force: false })
            : setConfirming({ kind: "unused" })
        }
      >
        Delete
      </Button>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={confirmation.title}
        message={confirmation.message}
        confirmLabel={confirmation.confirmLabel}
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => runDelete({ force: confirming?.kind === "inUse" })}
      />
    </>
  );
}
