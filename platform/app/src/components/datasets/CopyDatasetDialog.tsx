import { Button, createListCollection, Field, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { showErrorToast } from "~/features/errors";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useProjectsForCopy } from "../../hooks/useProjectsForCopy";
import { api } from "../../utils/api";
import { Dialog } from "../ui/dialog";
import { Select } from "../ui/select";
import { toaster } from "../ui/toaster";

export const CopyDatasetDialog = ({
  open,
  onClose,
  datasetId,
  datasetName,
}: {
  open: boolean;
  onClose: () => void;
  datasetId: string;
  datasetName: string;
}) => {
  const { project } = useOrganizationTeamProject();
  const copyDataset = api.dataset.copy.useMutation();
  const [selectedProjectId, setSelectedProjectId] = useState<string[]>([]);

  const projects = useProjectsForCopy("datasets:create")
    .filter((target) => target.hasCreatePermission)
    .map(({ label, value }) => ({ label, value }));

  const projectCollection = createListCollection({
    items: projects,
  });

  const handleCopy = async () => {
    const projectId = selectedProjectId[0];
    if (!projectId || !project) return;

    try {
      await copyDataset.mutateAsync({
        datasetId,
        projectId: projectId,
        sourceProjectId: project.id,
      });

      toaster.create({
        title: "Dataset replicated",
        description: `Dataset "${datasetName}" replicated successfully.`,
        type: "success",
      });

      onClose();
    } catch (error) {
      showErrorToast({
        error,
        fallbackTitle: "Couldn't replicate the dataset",
      });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content bg="bg" onClick={(e) => e.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>Replicate Dataset</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack gap={4} align={"start"}>
            <Field.Root>
              <Field.Label>Target Project</Field.Label>
              <Select.Root
                collection={projectCollection}
                value={selectedProjectId}
                onValueChange={(e) => setSelectedProjectId(e.value)}
              >
                <Select.Trigger>
                  <Select.ValueText placeholder="Select project" />
                </Select.Trigger>
                <Select.Content>
                  {projectCollection.items.map((project) => (
                    <Select.Item key={project.value} item={project}>
                      {project.label}
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
            onClick={() => {
              void handleCopy();
            }}
            loading={copyDataset.isPending}
            disabled={!selectedProjectId.length}
          >
            Replicate
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
};
