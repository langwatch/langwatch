// Replicates datasets across projects using host.copyTargets() for authz instead of server imports.

import { datasetClient } from "@langwatch/dataset-client";
import { Dialog } from "@langwatch/design-system/dialog";
import { createListCollection, Field, VStack } from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import { useMemo, useRef, useState } from "react";

import { useDatasetHost } from "../../model/dataset-host.ts";

export function CopyDatasetDialog({
  open,
  onClose,
  datasetId,
  datasetName,
}: {
  open: boolean;
  onClose: () => void;
  datasetId: string;
  datasetName: string;
}) {
  const host = useDatasetHost();
  const project = host.project();
  const copyDataset = datasetClient.dataset.copy.useMutation();
  const [selectedProjectId, setSelectedProjectId] = useState<string[]>([]);
  const [targetError, setTargetError] = useState<string | undefined>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const targets = host.copyTargets();
  const projectCollection = useMemo(() => createListCollection({ items: [...targets] }), [targets]);

  const handleCopy = async () => {
    const projectId = selectedProjectId[0];
    if (!projectId) {
      setTargetError("Choose the project to replicate the dataset to.");
      triggerRef.current?.focus();
      return;
    }
    if (!project) return;

    try {
      await copyDataset.mutateAsync({
        datasetId,
        projectId,
        sourceProjectId: project.id,
      });

      host.succeeded({
        title: "Dataset replicated",
        description: `Dataset "${datasetName}" replicated successfully.`,
      });

      onClose();
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't replicate the dataset" });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Replicate Dataset"
      busy={copyDataset.isPending}
      onSubmit={() => void handleCopy()}
      initialFocusEl={() => triggerRef.current}
      primaryAction={{
        label: "Replicate",
        type: "submit",
        loading: copyDataset.isPending,
      }}
    >
      <VStack gap={4} align="start">
        <Field.Root invalid={targetError !== undefined}>
          <Field.Label>Target Project</Field.Label>
          <Select.Root
            collection={projectCollection}
            value={selectedProjectId}
            onValueChange={(details) => {
              setSelectedProjectId(details.value);
              setTargetError(void 0);
            }}
          >
            <Select.Trigger ref={triggerRef}>
              <Select.ValueText placeholder="Select project" />
            </Select.Trigger>
            <Select.Content>
              {projectCollection.items.map((target) => (
                <Select.Item key={target.value} item={target}>
                  {target.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <Field.ErrorText>{targetError}</Field.ErrorText>
        </Field.Root>
      </VStack>
    </Dialog>
  );
}
