/**
 * Replicating a workflow into another project. A closed target is listed and greyed, not hidden. The dataset checkbox is this family's own: replicating a workflow without its dataset lands a graph that cannot run.
 */

import { Button, createListCollection, Field, Text, VStack } from "@chakra-ui/react";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Dialog } from "@langwatch/design-system/dialog";
import { Select } from "@langwatch/design-system/select";
import { useState } from "react";

import { workflowApi } from "../../model/workflow-api.ts";
import { useWorkflowHost } from "../../model/workflow-host.ts";

export function WorkflowReplicateDialog({
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
  const copyWorkflow = workflowApi.workflow.copy.useMutation();
  const [selected, setSelected] = useState<string[]>([]);
  const [copyDatasets, setCopyDatasets] = useState(false);

  const targets = host.copyTargets();
  const collection = createListCollection({
    items: targets.map((target) => ({ label: target.name, value: target.id })),
  });
  const chosen = targets.find((target) => target.id === selected[0]);

  if (!projectId) return null;

  const replicate = async () => {
    const targetProjectId = selected[0];
    if (!targetProjectId) return;

    try {
      await copyWorkflow.mutateAsync({
        workflowId,
        projectId: targetProjectId,
        sourceProjectId: projectId,
        copyDatasets,
      });
      host.succeeded({
        title: "Workflow replicated",
        description: `Workflow "${workflowName}" replicated successfully.`,
      });
      await utils.workflow.getAll.invalidate();
      onClose();
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't replicate the workflow" });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={({ open: isOpen }) => !isOpen && onClose()}>
      <Dialog.Content bg="bg" onClick={(event) => event.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>Replicate Workflow</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body paddingBottom={6}>
          <VStack gap={4} align="start">
            <Field.Root>
              <Field.Label>Target Project</Field.Label>
              <Select.Root
                collection={collection}
                value={selected}
                onValueChange={(event) => {
                  const target = targets.find((candidate) => candidate.id === event.value[0]);
                  if (target?.canCreate) setSelected(event.value);
                }}
              >
                <Select.Trigger>
                  <Select.ValueText placeholder="Select project" />
                </Select.Trigger>
                <Select.Content paddingY={2}>
                  {collection.items.map((item) => {
                    const canCreate =
                      targets.find((target) => target.id === item.value)?.canCreate ?? false;
                    return (
                      <Select.Item
                        key={item.value}
                        item={item}
                        opacity={canCreate ? 1 : 0.5}
                        cursor={canCreate ? "pointer" : "not-allowed"}
                      >
                        {item.label}
                        {!canCreate && (
                          <Text
                            display="inline-block"
                            fontSize="sm"
                            color="fg.subtle"
                            marginLeft={2}
                          >
                            (no permission)
                          </Text>
                        )}
                      </Select.Item>
                    );
                  })}
                </Select.Content>
              </Select.Root>
            </Field.Root>
            <Checkbox
              checked={copyDatasets}
              onCheckedChange={(event) => setCopyDatasets(!!event.checked)}
            >
              Replicate associated dataset
            </Checkbox>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            onClick={() => void replicate()}
            loading={copyWorkflow.isPending}
            disabled={selected.length === 0 || !chosen?.canCreate}
          >
            Replicate
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
