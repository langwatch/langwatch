/**
 * Replicating a workflow into another project.
 *
 * A NARROWED FAMILY-LOCAL COPY of
 * `platform/app/src/components/ui/ReplicateToProjectDialog.tsx` and the
 * `CopyWorkflowDialog` that wrapped it. Both were exclusive to this family, so
 * this is a MOVE rather than a copy — but it is narrowed the same way the
 * evaluator family narrowed its own: the platform component took a `title`, an
 * `entityLabel`, an `onCopy` callback, extra content and an error logger,
 * because three unrelated features shared it. Here the subject IS a workflow,
 * so the mutation is called directly and the words are written down.
 *
 * A CLOSED TARGET IS LISTED AND GREYED rather than hidden — the platform
 * dialog's behaviour, kept, because being told the project exists and is closed
 * to you is more use than a short list with no explanation.
 *
 * THE DATASET CHECKBOX IS THIS FAMILY'S OWN, and it is the reason the platform
 * dialog had an `extraContent` slot at all: a workflow can carry the dataset it
 * runs against, and replicating one without the other lands a graph in a
 * project that cannot run it.
 *
 * `isHandledByGlobalHandler` did not travel: a license limit the application
 * already turned into an upgrade modal is reported to the host as a failure
 * like any other, and the code-keyed presentation registry — which is the
 * application's — still decides the words.
 */

import { Button, createListCollection, Field, Text, VStack } from "@chakra-ui/react";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Dialog } from "@langwatch/design-system/dialog";
import { Select } from "@langwatch/design-system/select";
import { useState } from "react";

import { workflowApi } from "../../behavior/workflow-api";
import { useWorkflowHost } from "../../model/workflow-host";

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
