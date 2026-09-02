/**
 * Pushing a workflow's latest graph onto its replicas.
 *
 * A NARROWED FAMILY-LOCAL MOVE of
 * `platform/app/src/components/ui/PushToCopiesDialog.tsx` and the
 * `optimization_studio/components/workflow/PushToCopiesDialog` that wrapped it.
 * Both were exclusive to this family. The generic seam — `entityLabel`,
 * `bodyIntro`, `emptyMessage`, an `onPush` callback and a selection held by the
 * caller — is gone: the subject IS a workflow, so the words are written down
 * and the selection lives where it is used.
 *
 * EVERY REPLICA STARTS SELECTED, which is the platform behaviour and the one
 * worth stating: the reader opened this to push, and a dialog that opens with
 * nothing chosen makes the common case two steps.
 *
 * THE RESET IS KEYED ON THE REPLICA IDS AS A VALUE, not on the query result's
 * identity. `platform/app` depended on the result object, so a refetch — a
 * window refocus, an invalidation from a push — reset a reader's choices under
 * them while the dialog was open. The evaluator family found and fixed the same
 * defect in the same component; this is the other half of it.
 *
 * The failing branch reports the load error through the host's failure notice
 * rather than rendering `platform/app`'s `HandledErrorAlert`: the words a
 * customer reads come from the code-keyed presentation registry, which is the
 * application's and not a screen's to restate.
 */

import { Button, Text, VStack } from "@chakra-ui/react";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Dialog } from "@langwatch/design-system/dialog";
import { useEffect, useState } from "react";

import { workflowApi } from "../../behavior/workflow-api";
import { useWorkflowHost } from "../../model/workflow-host";

export function WorkflowPushToCopiesDialog({
  open,
  onClose,
  workflowId,
  workflowName,
}: {
  open: boolean;
  onClose: () => void;
  workflowId: string;
  workflowName: string;
}) {
  const host = useWorkflowHost();
  const { projectId } = host.scope();
  const utils = workflowApi.useUtils();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const copies = workflowApi.workflow.getCopies.useQuery(
    { workflowId, projectId: projectId ?? "" },
    { enabled: open && !!projectId && !!workflowId },
  );
  const pushToCopies = workflowApi.workflow.pushToCopies.useMutation();

  const copyIds = (copies.data ?? []).map((copy) => copy.id).join(",");
  useEffect(() => {
    setSelected(new Set(copyIds === "" ? [] : copyIds.split(",")));
  }, [copyIds]);

  useEffect(() => {
    if (copies.error) {
      host.failed({ error: copies.error, fallbackTitle: "Couldn't load replicas" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copies.error]);

  const toggle = (copyId: string) => {
    const next = new Set(selected);
    if (next.has(copyId)) next.delete(copyId);
    else next.add(copyId);
    setSelected(next);
  };

  const push = async () => {
    if (selected.size === 0 || !projectId) return;

    try {
      const result = await pushToCopies.mutateAsync({
        workflowId,
        projectId,
        copyIds: [...selected],
      });
      await utils.workflow.getAll.invalidate();
      host.succeeded({
        title: "Workflow pushed",
        description: `"${workflowName}" has been pushed to ${result.pushedTo} of ${result.selectedCopies} selected replicated workflow(s).`,
      });
      setSelected(new Set());
      onClose();
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't push the workflow" });
    }
  };

  const rows = copies.data ?? [];

  return (
    <Dialog.Root open={open} onOpenChange={({ open: isOpen }) => !isOpen && onClose()}>
      <Dialog.Content bg="bg" onClick={(event) => event.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>Push to Replicas</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack gap={4} align="start">
            <Text fontSize="sm" color="fg.muted">
              Select which replicas to push the latest version to:
            </Text>
            {copies.isLoading ? (
              <Text>Loading replicas...</Text>
            ) : rows.length === 0 ? (
              <Text color="fg.muted">
                No replicas found. This may be because you don&apos;t have workflows:update
                permission on the replica projects, or the replicas have been archived.
              </Text>
            ) : (
              <VStack gap={2} align="start" width="full">
                {rows.map((copy) => (
                  <Checkbox
                    key={copy.id}
                    checked={selected.has(copy.id)}
                    onCheckedChange={() => toggle(copy.id)}
                  >
                    <VStack align="start" gap={0}>
                      <Text fontWeight="medium">{copy.name}</Text>
                      <Text fontSize="sm" color="fg.muted">
                        {copy.fullPath}
                      </Text>
                    </VStack>
                  </Checkbox>
                ))}
              </VStack>
            )}
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            onClick={() => void push()}
            loading={pushToCopies.isPending}
            disabled={selected.size === 0 || copies.isLoading}
          >
            Push to {selected.size} replica{selected.size !== 1 ? "s" : ""}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
