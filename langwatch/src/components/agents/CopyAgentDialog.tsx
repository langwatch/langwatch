import {
  Button,
  createListCollection,
  Field,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { Dialog } from "../ui/dialog";
import { Select } from "../ui/select";
import { toaster } from "../ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import {
  hasPermissionWithHierarchy,
  teamRoleHasPermission,
} from "~/server/api/rbac";
import { api } from "~/utils/api";

export const CopyAgentDialog = ({
  open,
  onClose,
  onSuccess,
  agentId,
  agentName,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  agentId: string;
  agentName: string;
}) => {
  const { organizations, project } = useOrganizationTeamProject();
  const session = useRequiredSession();
  const copyAgent = api.agents.copy.useMutation();
  const [selectedProjectId, setSelectedProjectId] = useState<string[]>([]);

  const currentUserId = session.data?.user?.id;

  const projects =
    organizations?.flatMap((org) =>
      org.teams.flatMap((team) => {
        const teamMember = team.members.find(
          (member) => member.userId === currentUserId,
        );
        if (!teamMember) return [];

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

        return team.projects.map((proj) => ({
          label: `${org.name} / ${team.name} / ${proj.name}`,
          value: proj.id,
          hasCreatePermission: hasTeamManagePermission,
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
      await copyAgent.mutateAsync({
        agentId,
        projectId,
        sourceProjectId: project.id,
      });

      toaster.create({
        title: "Agent replicated",
        description: `Agent "${agentName}" replicated successfully.`,
        type: "success",
      });

      onSuccess?.();
      onClose();
    } catch (error) {
      toaster.create({
        title: "Error replicating agent",
        description: error instanceof Error ? error.message : "Unknown error",
        type: "error",
      });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content onClick={(e) => e.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>Replicate Agent</Dialog.Title>
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
                  if (selectedProject?.hasCreatePermission) {
                    setSelectedProjectId(e.value);
                  }
                }}
              >
                <Select.Trigger>
                  <Select.ValueText placeholder="Select project" />
                </Select.Trigger>
                <Select.Content zIndex="1600">
                  {projectCollection.items.map((proj) => {
                    const hasPermission = proj.hasCreatePermission;
                    return (
                      <Select.Item
                        key={proj.value}
                        item={proj}
                        opacity={hasPermission ? 1 : 0.5}
                        cursor={hasPermission ? "pointer" : "not-allowed"}
                      >
                        {proj.label}
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
            loading={copyAgent.isLoading}
            disabled={
              !selectedProjectId.length ||
              !projects.find((p) => p.value === selectedProjectId[0])
                ?.hasCreatePermission
            }
          >
            Replicate
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
};
