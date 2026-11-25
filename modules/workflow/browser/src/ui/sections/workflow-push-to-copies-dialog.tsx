/**
 * Push workflow graph to replicas (all pre-selected).
 * Reset keyed on ID values to prevent mid-dialog changes from refetches.
 */

import { Checkbox } from "@langwatch/design-system/checkbox";
import { Dialog } from "@langwatch/design-system/dialog";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Text, VStack } from "@langwatch/design-system/primitives";
import { Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { workflowApi } from "../../behavior/workflow-api.ts";
import { useWorkflowHost } from "../../model/workflow-host.ts";

const REPLICATE_DOCS = "https://docs.langwatch.ai/workflows/building-a-workflow";

/** One replica, as the picker lists it. */
type WorkflowCopy = { id: string; name: string; fullPath: string };

/** The replica picker: loading, empty, or the list of replicas to push to. */
function ReplicaPicker({
  isLoading,
  onToggle,
  rows,
  selected,
}: {
  isLoading: boolean;
  onToggle: (id: string) => void;
  rows: WorkflowCopy[];
  selected: ReadonlySet<string>;
}) {
  if (isLoading) return <Text>Loading replicas...</Text>;

  if (rows.length === 0) {
    return (
      <NoDataInfoBlock
        size="inline"
        icon={<Copy size={24} />}
        title="No replicas found"
        description="You may not have workflows:update permission on the replica projects, or the replicas have been archived."
        next={[{ kind: "docs", label: "Read about replicating workflows", href: REPLICATE_DOCS }]}
      />
    );
  }

  return (
    <VStack gap={2} align="start" width="full">
      {rows.map((copy) => (
        <Checkbox
          key={copy.id}
          checked={selected.has(copy.id)}
          onCheckedChange={() => onToggle(copy.id)}
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
  );
}

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
  const [edited, setEdited] = useState<{ copyIds: string; selected: ReadonlySet<string> } | null>(
    null,
  );

  const copies = workflowApi.workflow.getCopies.useQuery(
    { workflowId, projectId: projectId ?? "" },
    { enabled: open && !!projectId && !!workflowId },
  );
  const pushToCopies = workflowApi.workflow.pushToCopies.useMutation();

  const copyIds = (copies.data ?? []).map((copy) => copy.id).join(",");
  const selected: ReadonlySet<string> =
    edited?.copyIds === copyIds
      ? edited.selected
      : new Set(copyIds === "" ? [] : copyIds.split(","));

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
    setEdited({ copyIds, selected: next });
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
      setEdited({ copyIds, selected: new Set() });
      onClose();
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't push the workflow" });
    }
  };

  const rows = copies.data ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Push to Replicas"
      primaryAction={{
        label: `Push to ${selected.size} replica${selected.size !== 1 ? "s" : ""}`,
        onClick: () => void push(),
        loading: pushToCopies.isPending,
        disabledReason:
          selected.size === 0 || copies.isLoading ? "Select at least one replica" : undefined,
      }}
    >
      <VStack gap={4} align="start">
        <Text fontSize="sm" color="fg.muted">
          Select which replicas to push the latest version to:
        </Text>
        <ReplicaPicker
          isLoading={copies.isLoading}
          onToggle={toggle}
          rows={rows}
          selected={selected}
        />
      </VStack>
    </Dialog>
  );
}
