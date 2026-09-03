import { Button, createListCollection, Field, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { showErrorToast } from "@langwatch/workflow-web/studio-host/errors";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";
import { api } from "@langwatch/workflow-web/studio-host/api";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Dialog } from "@langwatch/workflow-web/components/ui/dialog";
import { Select } from "@langwatch/design-system/select";
import { toaster } from "@langwatch/workflow-web/studio-host/toaster";

export const CopyExperimentDialog = ({
  open,
  onClose,
  experimentId,
  experimentName,
}: {
  open: boolean;
  onClose: () => void;
  experimentId: string;
  experimentName: string;
}) => {
  const { copyTargets, project } = useOrganizationTeamProject();
  const utils = api.useUtils();
  const copyExperiment = api.experiments.copy.useMutation();
  const [selectedProjectId, setSelectedProjectId] = useState<string[]>([]);
  const [copyDatasets, setCopyDatasets] = useState(false);

  /**
   * Where this experiment may be replicated to.
   *
   * `platform/app` walked the organization graph here and asked
   * `~/server/api/rbac` whether the reader's team membership carried
   * `evaluations:manage` — a server module imported into a browser component,
   * with the reader's own id read off the session. The host answers the same
   * question now, derived from `@langwatch/authz-contract` by the composing
   * application, and a target the reader cannot create in is still LISTED and
   * greyed rather than hidden, which is what this select has always done.
   */
  const projects = copyTargets.map((target) => ({
    label: target.name,
    value: target.id,
    hasManagePermission: target.canCreate,
  }));

  const projectCollection = createListCollection({
    items: projects,
  });

  const handleCopy = async () => {
    const projectId = selectedProjectId[0];
    if (!projectId || !project) return;

    const selectedProject = projects.find((p) => p.value === projectId);
    const targetProjectPath = selectedProject?.label ?? "selected project";

    try {
      await copyExperiment.mutateAsync({
        experimentId,
        projectId: projectId,
        sourceProjectId: project.id,
        copyDatasets,
      });

      // Invalidate queries to refresh the experiment list
      await utils.experiments.getAllForEvaluationsList.invalidate();

      toaster.create({
        title: "Experiment replicated",
        description: `Experiment "${experimentName}" replicated successfully to ${targetProjectPath}.`,
        type: "success",
      });

      onClose();
    } catch (error) {
      showErrorToast({
        error,
        fallbackTitle: "Couldn't replicate the experiment",
      });
    }
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
                          <Text
                            display="inline-block"
                            fontSize="sm"
                            color="fg.subtle"
                            ml={2}
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
              onCheckedChange={(e) => setCopyDatasets(!!e.checked)}
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
            onClick={() => {
              void handleCopy();
            }}
            loading={copyExperiment.isPending}
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
