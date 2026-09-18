import { Button, createListCollection, Field, Text, VStack } from "@chakra-ui/react";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Select } from "@langwatch/design-system/select";
import { Dialog } from "@langwatch/design-system/studio-dialog";
import { useOrganizationTeamProject } from "@langwatch/workflow-browser/studio-scope";
import { useState } from "react";

export const CopyExperimentDialog = ({
  open,
  onClose,
  isCopying,
  onCopy,
}: {
  open: boolean;
  onClose: () => void;
  isCopying: boolean;
  onCopy: (params: {
    targetProjectId: string;
    targetProjectName: string;
    copyDatasets: boolean;
  }) => void;
}) => {
  const { copyTargets, project } = useOrganizationTeamProject();
  const [selectedProjectId, setSelectedProjectId] = useState<string[]>([]);
  const [copyDatasets, setCopyDatasets] = useState(false);

  /**
   * Where this experiment may be replicated to.
   */
  const projects = copyTargets.map((target) => ({
    label: target.name,
    value: target.id,
    hasManagePermission: target.canCreate,
  }));

  const projectCollection = createListCollection({
    items: projects,
  });

  const handleCopy = () => {
    const targetProjectId = selectedProjectId[0];
    if (!targetProjectId || !project) return;

    const selectedProject = projects.find((p) => p.value === targetProjectId);
    onCopy({
      targetProjectId,
      targetProjectName: selectedProject?.label ?? "selected project",
      copyDatasets,
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content bg="bg" onClick={(e) => e.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>Replicate Experiment</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack gap={4} align={"start"}>
            <Field.Root>
              <Field.Label>Target Project</Field.Label>
              <Select.Root
                collection={projectCollection}
                value={selectedProjectId}
                onValueChange={(e) => {
                  const selectedProject = projects.find((p) => p.value === e.value[0]);
                  // Only allow selection if user has manage permission
                  if (selectedProject?.hasManagePermission) {
                    setSelectedProjectId(e.value);
                  }
                }}
              >
                <Select.Trigger>
                  <Select.ValueText placeholder="Select project" />
                </Select.Trigger>
                <Select.Content>
                  {projectCollection.items.map((project) => {
                    const hasPermission = project.hasManagePermission;
                    return (
                      <Select.Item
                        key={project.value}
                        item={project}
                        opacity={hasPermission ? 1 : 0.5}
                        cursor={hasPermission ? "pointer" : "not-allowed"}
                      >
                        {project.label}
                        {!hasPermission && (
                          <Text display="inline-block" fontSize="sm" color="fg.subtle" ml={2}>
                            (no permission)
                          </Text>
                        )}
                      </Select.Item>
                    );
                  })}
                </Select.Content>
              </Select.Root>
            </Field.Root>
            <Checkbox checked={copyDatasets} onCheckedChange={(e) => setCopyDatasets(!!e.checked)}>
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
            onClick={handleCopy}
            loading={isCopying}
            disabled={
              !selectedProjectId.length ||
              !projects.find((p) => p.value === selectedProjectId[0])?.hasManagePermission
            }
          >
            Replicate
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
};
