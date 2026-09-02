/**
 * Replicating an evaluator into another project.
 *
 * A NARROWED FAMILY-LOCAL COPY of
 * `platform/app/src/components/ui/ReplicateToProjectDialog.tsx` (plus the
 * `CopyEvaluatorDialog` that wrapped it), which the monitor and workflow copy
 * dialogs also render, so the platform module stays.
 *
 * What was narrowed away is the generic seam: the platform component took a
 * `title`, an `entityLabel`, an `onCopy` callback, optional extra content and
 * an error logger, because three unrelated features shared it. Here the subject
 * IS an evaluator, so the mutation is called directly and the words are
 * written down.
 *
 * A CLOSED TARGET IS LISTED AND GREYED rather than hidden — the platform
 * dialog's behaviour, kept, because being told the project exists and is closed
 * to you is more use than a short list with no explanation.
 *
 * This is a SECTION and not a block because it calls a hook: only `sections`
 * may depend on `behavior`, which `ui-web-layer-direction` decides rather than
 * taste.
 */

import { Button, createListCollection, Field, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { Select } from "@langwatch/design-system/select";
import { useState } from "react";

import { evaluatorApi } from "../../behavior/evaluator-api";
import { useEvaluatorHost } from "../../model/evaluator-host";

export function EvaluatorReplicateDialog({
  open,
  onClose,
  onSuccess,
  evaluatorId,
  evaluatorName,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  evaluatorId: string;
  evaluatorName: string;
}) {
  const host = useEvaluatorHost();
  const { projectId } = host.scope();
  const [selected, setSelected] = useState<string[]>([]);
  const copyEvaluator = evaluatorApi.evaluators.copy.useMutation();

  const targets = host.copyTargets();
  const collection = createListCollection({
    items: targets.map((target) => ({ label: target.name, value: target.id })),
  });
  const chosen = targets.find((target) => target.id === selected[0]);

  const replicate = async () => {
    const targetProjectId = selected[0];
    if (!targetProjectId || !projectId) return;

    try {
      await copyEvaluator.mutateAsync({
        evaluatorId,
        projectId: targetProjectId,
        sourceProjectId: projectId,
      });
      host.succeeded({
        title: "Evaluator replicated",
        description: `Evaluator "${evaluatorName}" replicated successfully.`,
      });
      onSuccess?.();
      onClose();
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't replicate the evaluator" });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={({ open: isOpen }) => !isOpen && onClose()}>
      <Dialog.Content bg="bg" onClick={(event) => event.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>Replicate Evaluator</Dialog.Title>
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
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            onClick={() => void replicate()}
            loading={copyEvaluator.isPending}
            disabled={selected.length === 0 || !chosen?.canCreate}
          >
            Replicate
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
