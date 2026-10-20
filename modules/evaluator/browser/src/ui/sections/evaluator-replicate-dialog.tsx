/**
 * Replicating an evaluator to another project. A narrowed copy of platform/app's
 * ReplicateToProjectDialog. Closed targets are greyed to show inaccessibility.
 * Implemented as a section (not block) because it calls a hook.
 */

import { Dialog } from "@langwatch/design-system/dialog";
import { createListCollection, Field, Text, VStack } from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import { evaluatorClient } from "@langwatch/evaluator-client";
import { useState } from "react";

import { useEvaluatorHost } from "../../model/evaluator-host.ts";

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
  const [attempted, setAttempted] = useState(false);
  const copyEvaluator = evaluatorClient.evaluators.copy.useMutation();

  // Read only while open: each target costs one permissions read per project.
  const targets = open ? host.copyTargets() : [];
  const collection = createListCollection({
    items: targets.map((target) => ({ label: target.name, value: target.id })),
  });
  const chosen = targets.find((target) => target.id === selected[0]);

  const replicate = async () => {
    if (copyEvaluator.isPending) return;
    const targetProjectId = selected[0];
    if (!targetProjectId || !chosen?.canCreate) return setAttempted(true);
    if (!projectId) return;

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
    <Dialog
      open={open}
      onClose={onClose}
      title="Replicate Evaluator"
      busy={copyEvaluator.isPending}
      primaryAction={{
        label: "Replicate",
        onClick: () => void replicate(),
        loading: copyEvaluator.isPending,
      }}
    >
      <VStack gap={4} align="start">
        <Field.Root invalid={attempted && !chosen?.canCreate}>
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
                      <Text display="inline-block" fontSize="sm" color="fg.subtle" marginLeft={2}>
                        (no permission)
                      </Text>
                    )}
                  </Select.Item>
                );
              })}
            </Select.Content>
          </Select.Root>
          <Field.ErrorText>Choose a project you can create evaluators in.</Field.ErrorText>
        </Field.Root>
      </VStack>
    </Dialog>
  );
}
