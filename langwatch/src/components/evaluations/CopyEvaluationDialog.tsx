import {
  Button,
  createListCollection,
  Field,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { Checkbox } from "../ui/checkbox";
import { Dialog } from "../ui/dialog";
import { Select } from "../ui/select";
import { toaster } from "../ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import {
  hasPermissionWithHierarchy,
  teamRoleHasPermission,
} from "../../server/api/rbac";
import { api } from "../../utils/api";

export const CopyEvaluationDialog = ({
  open,
  onClose,
  experimentId,
  evaluationName,
}: {
  open: boolean;
  onClose: () => void;
  experimentId: string;
  evaluationName: string;
}) => {
  const { organizations, project } = useOrganizationTeamProject();
  const session = useRequiredSession();
  const utils = api.useContext();
  const copyExperiment = api.experiments.copy.useMutation();
  const [selectedProjectId, setSelectedProjectId] = useState<string[]>([]);
  const [copyDatasets, setCopyDatasets] = useState(false);

  const currentUserId = session.data?.user?.id;

  const projects =
    organizations?.flatMap((org) =>
      org.teams.flatMap((team) => {
        // Find the current user's membership in this team
        const teamMember = team.members.find(
          (member) => member.userId === currentUserId,
        );
        if (!teamMember) return [];

        // Check if user has evaluations:manage permission in this team
        let hasTeamManagePermission = false;
        if (teamMember.assignedRole) {
          const permissions =
            (teamMember.assignedRole.permissions as string[]) ?? [];
          if (permissions.length > 0) {
            hasTeamManagePermission = hasPermissionWithHierarchy(
              permissions,
              "evaluations:manage",
            );
          } else {
            hasTeamManagePermission = teamRoleHasPermission(
              teamMember.role,
              "evaluations:manage",
            );
          }
        } else {
          hasTeamManagePermission = teamRoleHasPermission(
            teamMember.role,
            "evaluations:manage",
          );
        }

        // Include all projects, but mark which ones have permission
        return team.projects.map((project) => ({
          label: `${org.name} / ${team.name} / ${project.name}`,
          value: project.id,
          hasManagePermission: hasTeamManagePermission,
        }));
      }),
    ) ?? [];

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
        title: "Evaluation replicated",
        description: `Evaluation "${evaluationName}" replicated successfully to ${targetProjectPath}.`,
        type: "success",
      });

      onClose();
    } catch (error) {
      toaster.create({
        title: "Error replicating evaluation",
        description: error instanceof Error ? error.message : "Unknown error",
        type: "error",
      });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Backdrop />
      <Dialog.Content onClick={(e) => e.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>Replicate Evaluation</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack gap={4} align={"start"}>
            <Field.Root>
              <Field.Label>Target Project</Field.Label>
              <Select.Root
                collection={projectCollection}
                value={selectedProjectId}
                onValueChange={(e) => {
                  const selectedProject = projects.find(
                    (p) => p.value === e.value[0],
                  );
                  // Only allow selection if user has manage permission
                  if (selectedProject?.hasManagePermission) {
                    setSelectedProjectId(e.value);
                  }
                }}
              >
                <Select.Trigger>
                  <Select.ValueText placeholder="Select project" />
                </Select.Trigger>
                <Select.Content zIndex="1600">
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
                            color="gray.400"
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
            loading={copyExperiment.isLoading}
            disabled={
              !selectedProjectId.length ||
              !projects.find((p) => p.value === selectedProjectId[0])
                ?.hasManagePermission
            }
          >
            Replicate
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
};

