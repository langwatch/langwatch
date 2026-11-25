/**
 * Pushing an evaluator's configuration onto its replicas. A narrowed copy of
 * platform/app's PushToCopiesDialog. Replicas start selected (common case optimization).
 * Errors route through the host's failure notice for code-keyed presentation.
 */

import { Checkbox } from "@langwatch/design-system/checkbox";
import { Dialog } from "@langwatch/design-system/dialog";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Text, VStack } from "@langwatch/design-system/primitives";
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
  const [attempted, setAttempted] = useState(false);
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
    if (pushToCopies.isPending) return;
    if (selected.size === 0) return setAttempted(true);
    if (!projectId) return;
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
  const { copiesFailed, hasNoCopies, hasCopies } = replicaStateOf({
    isLoading: copies.isLoading,
    isError: copies.isError,
    count: copies.data?.length ?? 0,
  });
  const unavailable = pushUnavailableReason({
    isLoading: copies.isLoading,
    failed: copiesFailed,
    empty: hasNoCopies,
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Push to Replicas"
      busy={pushToCopies.isPending}
      primaryAction={{
        label: `Push to ${selected.size} replica${selected.size !== 1 ? "s" : ""}`,
        onClick: () => void push(),
        loading: pushToCopies.isPending,
        ...(unavailable ? { disabledReason: unavailable } : {}),
      }}
    >
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
        {hasNoCopies && (
          <NoDataInfoBlock
            size="line"
            title="No replicas found. Use Replicate on the evaluator's menu to create one."
            next={[
              {
                kind: "docs",
                label: "Saved evaluators",
                href: "https://docs.langwatch.ai/evaluations/evaluators/saved-evaluators",
              },
            ]}
          />
        )}
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
        {attempted && hasCopies && selected.size === 0 && (
          <Text role="alert" color="red.fg" textStyle="sm">
            Select at least one replica to push to.
          </Text>
        )}
      </VStack>
    </Dialog>
  );
}

function pushUnavailableReason({
  isLoading,
  failed,
  empty,
}: {
  isLoading: boolean;
  failed: boolean;
  empty: boolean;
}) {
  if (isLoading) return "Replicas are still loading.";
  if (failed) return "Replicas could not be loaded.";
  if (empty) return "There are no replicas to push to.";
  return void 0;
}

function replicaStateOf({
  isLoading,
  isError,
  count,
}: {
  isLoading: boolean;
  isError: boolean;
  count: number;
}) {
  const ready = !isLoading && !isError;
  return {
    copiesFailed: !isLoading && isError,
    hasNoCopies: ready && count === 0,
    hasCopies: ready && count !== 0,
  };
}
