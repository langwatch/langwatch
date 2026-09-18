// Replicates datasets across projects using host.copyTargets() for authz instead of server imports.

import { Button, createListCollection, Field, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { Select } from "@langwatch/design-system/select";
import { useMemo, useState } from "react";

import { datasetApi } from "../../behavior/dataset-api.ts";
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
  const copyDataset = datasetApi.dataset.copy.useMutation();
  const [selectedProjectId, setSelectedProjectId] = useState<string[]>([]);

  const targets = host.copyTargets();
  const projectCollection = useMemo(() => createListCollection({ items: [...targets] }), [targets]);

  const handleCopy = async () => {
    const projectId = selectedProjectId[0];
    if (!projectId || !project) return;

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
    <Dialog.Root open={open} onOpenChange={(details) => !details.open && onClose()}>
      <Dialog.Content bg="bg" onClick={(event) => event.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>Replicate Dataset</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack gap={4} align="start">
            <Field.Root>
              <Field.Label>Target Project</Field.Label>
              <Select.Root
                collection={projectCollection}
                value={selectedProjectId}
                onValueChange={(details) => setSelectedProjectId(details.value)}
              >
                <Select.Trigger>
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
            </Field.Root>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            onClick={() => void handleCopy()}
            loading={copyDataset.isPending}
            disabled={!selectedProjectId.length}
          >
            Replicate
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
