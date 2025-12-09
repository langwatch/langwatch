import {
  Button,
  createListCollection,
  Field,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { Dialog } from "../../components/ui/dialog";
import { Select } from "../../components/ui/select";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import { api } from "../../utils/api";

import {
  hasPermissionWithHierarchy,
  teamRoleHasPermission,
} from "../../server/api/rbac";

export const CopyPromptDialog = ({
  open,
  onClose,
  promptId,
  promptName,
}: {
  open: boolean;
  onClose: () => void;
  promptId: string;
  promptName: string;
}) => {
  const { organizations, project } = useOrganizationTeamProject();
  const session = useRequiredSession();
  const copyPrompt = api.prompts.copy.useMutation();
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

        // Check if user has prompts:create permission in this team
        let hasTeamCreatePermission = false;
        if (teamMember.assignedRole) {
          const permissions =
            (teamMember.assignedRole.permissions as string[]) ?? [];
          if (permissions.length > 0) {
            hasTeamCreatePermission = hasPermissionWithHierarchy(
              permissions,
              "prompts:create",
            );
          } else {
            hasTeamCreatePermission = teamRoleHasPermission(
              teamMember.role,
              "prompts:create",
            );
          }
        } else {
          hasTeamCreatePermission = teamRoleHasPermission(
            teamMember.role,
            "prompts:create",
          );
        }

        // Include all projects, but mark which ones have permission
        return team.projects.map((project) => ({
          label: `${org.name} / ${team.name} / ${project.name}`,
          value: project.id,
          hasCreatePermission: hasTeamCreatePermission,
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
      await copyPrompt.mutateAsync({
        idOrHandle: promptId,
        projectId: projectId,
        sourceProjectId: project.id,
      });

      toaster.create({
        title: "Prompt copied",
        description: `Prompt "${promptName}" copied successfully.`,
        type: "success",
      });

      onClose();
    } catch (error) {
      toaster.create({
        title: "Error copying prompt",
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
          <Dialog.Title>Copy Prompt</Dialog.Title>
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
                  // Only allow selection if user has create permission
                  if (selectedProject?.hasCreatePermission) {
                    setSelectedProjectId(e.value);
                  }
                }}
              >
                <Select.Trigger>
                  <Select.ValueText placeholder="Select project" />
                </Select.Trigger>
                <Select.Content zIndex="1600">
                  {projectCollection.items.map((project) => {
                    const hasPermission = project.hasCreatePermission;
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
            loading={copyPrompt.isLoading}
            disabled={
              !selectedProjectId.length ||
              !projects.find((p) => p.value === selectedProjectId[0])
                ?.hasCreatePermission
            }
          >
            Copy
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
};


