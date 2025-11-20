import { Button, createListCollection, Field, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { Dialog } from "../../../components/ui/dialog";
import { Select } from "../../../components/ui/select";
import { toaster } from "../../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../../../hooks/useRequiredSession";
import { api } from "../../../utils/api";

import {
  hasPermissionWithHierarchy,
  teamRoleHasPermission,
} from "../../../server/api/rbac";

import { Checkbox } from "../../../components/ui/checkbox";

export const CopyWorkflowDialog = ({
  open,
  onClose,
  workflowId,
  workflowName,
}: {
  open: boolean;
  onClose: () => void;
  workflowId: string;
  workflowName: string;
}) => {
  const { organizations, project } = useOrganizationTeamProject();
  const session = useRequiredSession();
  const copyWorkflow = api.workflow.copy.useMutation();
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

        let hasCreatePermission = false;
        if (teamMember.assignedRole) {
          const permissions =
            (teamMember.assignedRole.permissions as string[]) ?? [];
          if (permissions.length > 0) {
            hasCreatePermission = hasPermissionWithHierarchy(
              permissions,
              "workflows:create",
            );
          } else {
            hasCreatePermission = teamRoleHasPermission(
              teamMember.role,
              "workflows:create",
            );
          }
        } else {
          hasCreatePermission = teamRoleHasPermission(
            teamMember.role,
            "workflows:create",
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
      await copyWorkflow.mutateAsync({
        workflowId,
        projectId: projectId,
        sourceProjectId: project.id,
        copyDatasets,
      });

      toaster.create({
        title: "Workflow copied",
        description: `Workflow "${workflowName}" copied successfully.`,
        type: "success",
      });

      onClose();
    } catch (error) {
      toaster.create({
        title: "Error copying workflow",
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
          <Dialog.Title>Copy Workflow</Dialog.Title>
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
            <Checkbox
              checked={copyDatasets}
              onCheckedChange={(e) => setCopyDatasets(!!e.checked)}
            >
              Copy associated dataset
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
            loading={copyWorkflow.isLoading}
            disabled={!selectedProjectId.length}
          >
            Copy
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
};
