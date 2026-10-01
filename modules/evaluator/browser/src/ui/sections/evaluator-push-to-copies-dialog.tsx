/**
 * Pushing an evaluator's configuration onto its replicas. A narrowed copy of
 * platform/app's PushToCopiesDialog. Replicas start selected (common case optimization).
 * Errors route through the host's failure notice for code-keyed presentation.
 */

import { Checkbox } from "@langwatch/design-system/checkbox";
import { Dialog } from "@langwatch/design-system/dialog";
import { Button, Text, VStack } from "@langwatch/design-system/primitives";
import { evaluatorClient } from "@langwatch/evaluator-client";
import { useState } from "react";

import { useEvaluatorHost } from "../../model/evaluator-host.ts";

export function EvaluatorPushToCopiesDialog({
  open,
  onClose,
  evaluatorId,
  evaluatorName,
}: {
  open: boolean;
  onClose: () => void;
  evaluatorId: string;
  evaluatorName: string;
}) {
  const host = useEvaluatorHost();
  const { projectId } = host.scope();
  const [edited, setEdited] = useState<{ copyIds: string; selected: ReadonlySet<string> } | null>(
    null,
  );

  const copies = evaluatorClient.evaluators.getCopies.useQuery(
    { evaluatorId, projectId: projectId ?? "" },
    { enabled: open && !!projectId && !!evaluatorId },
  );
  const pushToCopies = evaluatorClient.evaluators.pushToCopies.useMutation();

  /**
   * Selection keys off the IDS, not the query result's identity: keying
   * by identity reset a reader's mid-dialog choices on every refetch
   * (refocus, push invalidation). IDs only change when replicas do.
   */
  const copyIds = (copies.data ?? []).map((copy) => copy.id).join(",");
  const selected: ReadonlySet<string> =
    edited?.copyIds === copyIds
      ? edited.selected
      : new Set(copyIds === "" ? [] : copyIds.split(","));

  const toggle = (copyId: string) => {
    const next = new Set(selected);
    if (next.has(copyId)) next.delete(copyId);
    else next.add(copyId);
    setEdited({ copyIds, selected: next });
  };

  const push = async () => {
    if (selected.size === 0 || !projectId) return;
    try {
      const result = await pushToCopies.mutateAsync({
        evaluatorId,
        projectId,
        copyIds: Array.from(selected),
      });
      host.succeeded({
        title: "Evaluator pushed",
        description: `"${evaluatorName}" has been pushed to ${result.pushedTo} of ${result.selectedCopies} selected replicated evaluator(s).`,
      });
      setEdited({ copyIds, selected: new Set() });
      onClose();
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't push the evaluator" });
    }
  };
  const copiesFailed = !copies.isLoading && copies.isError;
  const copiesReady = !copies.isLoading && !copies.isError;
  const hasNoCopies = copiesReady && (copies.data?.length ?? 0) === 0;
  const hasCopies = copiesReady && (copies.data?.length ?? 0) !== 0;

  return (
    <Dialog.Root open={open} onOpenChange={({ open: isOpen }) => !isOpen && onClose()}>
      <Dialog.Content bg="bg" onClick={(event) => event.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>Push to Replicas</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack gap={4} align="start">
            <Text fontSize="sm" color="fg.muted">
              Select which replicas to push the latest config to:
            </Text>
            {copies.isLoading && <Text>Loading replicas...</Text>}
            {copiesFailed && (
              <Text role="alert" color="red.fg">
                Couldn&apos;t load replicas.
              </Text>
            )}
            {hasNoCopies && <Text color="fg.muted">No replicas found.</Text>}
            {hasCopies && (
              <VStack gap={2} align="start" width="full">
                {copies.data?.map((copy) => (
                  <Checkbox
                    key={copy.id}
                    checked={selected.has(copy.id)}
                    onChange={() => toggle(copy.id)}
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
