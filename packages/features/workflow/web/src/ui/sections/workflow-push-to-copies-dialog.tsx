/**
 * Pushing a workflow's latest graph onto its replicas. Every replica starts selected, since the reader opened this to push. Reset is keyed on the replica IDs AS A VALUE, not the query result's identity, or a refetch resets choices mid-dialog. Load errors go through the host's failure notice, not a local alert.
 */

import { Button, Text, VStack } from "@chakra-ui/react";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Dialog } from "@langwatch/design-system/dialog";
import { useEffect, useState } from "react";

import { workflowApi } from "../../model/workflow-api.ts";
import { useWorkflowHost } from "../../model/workflow-host.ts";

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
