import { Button } from "@chakra-ui/react";
import { useState } from "react";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import { inUseDeleteConfirmation, readInUseCount } from "./slackConnectionCopy";
import type { SlackConnection } from "./slackConnectionTypes";

/**
 * Deletes without force first. A connection automations still deliver
 * through is refused with the count, and only then does the reader confirm
 * that those automations stop delivering (ADR-093 §5a).
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
  const [inUseCount, setInUseCount] = useState<number | null>(null);
  const remove = api.slackIntegration.delete.useMutation();

  const runDelete = ({ force }: { force: boolean }) =>
    remove.mutate(
      { projectId, id: connection.id, ...(force ? { force: true } : {}) },
      {
        onSuccess: () => {
          setInUseCount(null);
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
            setInUseCount(count);
            return;
          }
          showErrorToast({
            error,
            fallbackTitle: "Couldn't delete the Slack connection",
          });
        },
      },
    );

  const confirmation = inUseDeleteConfirmation({
    name: connection.name,
    count: inUseCount ?? 0,
  });

  return (
    <>
      <Button
        variant="outline"
        colorPalette="red"
        loading={remove.isPending && inUseCount === null}
        onClick={() => runDelete({ force: false })}
      >
        Delete
      </Button>
      <ConfirmDialog
        open={inUseCount !== null}
        onOpenChange={(open) => {
          if (!open) setInUseCount(null);
        }}
        title={confirmation.title}
        message={confirmation.message}
        confirmLabel={confirmation.confirmLabel}
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => runDelete({ force: true })}
      />
    </>
  );
}
