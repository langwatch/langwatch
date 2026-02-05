import { Button, createListCollection, Field, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import {
  hasPermissionWithHierarchy,
  teamRoleHasPermission,
} from "../../server/api/rbac";
import { api } from "../../utils/api";
import { isHandledByGlobalLicenseHandler } from "../../utils/trpcError";
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
  const { organizations, project } = useOrganizationTeamProject();
  const session = useRequiredSession();
  const copyDataset = api.dataset.copy.useMutation();
  const [selectedProjectId, setSelectedProjectId] = useState<string[]>([]);

  const currentUserId = session.data?.user?.id;

  const projects =
    organizations?.flatMap((org) =>
      org.teams.flatMap((team) => {
        // Find the current user's membership in this team
        const teamMember = team.members.find(
          (member) => member.userId === currentUserId,
        );
        if (!teamMember) return [];

        let hasCreatePermission = false;
        if (teamMember.assignedRole) {
          const permissions =
            (teamMember.assignedRole.permissions as string[]) ?? [];
          if (permissions.length > 0) {
            hasCreatePermission = hasPermissionWithHierarchy(
              permissions,
              "datasets:create",
            );
          } else {
            hasCreatePermission = teamRoleHasPermission(
              teamMember.role,
              "datasets:create",
            );
          }
        } else {
          hasCreatePermission = teamRoleHasPermission(
            teamMember.role,
            "datasets:create",
          );
        }

        if (!hasCreatePermission) return [];

        return team.projects.map((project) => ({
          label: `${org.name} / ${team.name} / ${project.name}`,
          value: project.id,
        }));
      }),
    ) ?? [];

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
      // Skip toast if the global license handler already showed the upgrade modal
      if (isHandledByGlobalLicenseHandler(error)) return;
      toaster.create({
        title: "Error replicating dataset",
        description: error instanceof Error ? error.message : "Unknown error",
        type: "error",
      });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content onClick={(e) => e.stopPropagation()}>
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
                <Select.Content zIndex="1600">
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
            loading={copyDataset.isLoading}
            disabled={!selectedProjectId.length}
          >
            Replicate
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
};
