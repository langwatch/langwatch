import { HStack, Text } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useDrawer } from "../../hooks/useDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { trackEvent } from "../../utils/tracking";
import { Drawer } from "../ui/drawer";
import { toaster } from "../ui/toaster";
import { ProjectForm, type ProjectFormData } from "./ProjectForm";
import type { FrameworkKey, LanguageKey } from "./techStackOptions";

export function CreateProjectDrawer({
  open = true,
  onClose,
  navigateOnCreate = false,
}: {
  open?: boolean;
  onClose?: () => void;
  navigateOnCreate?: boolean;
}): React.ReactElement {
  const router = useRouter();
  const { organization } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();
  const queryClient = api.useContext();

  const createProject = api.project.create.useMutation();

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      closeDrawer();
    }
  };

  const handleSubmit = (
    data: ProjectFormData & { language: LanguageKey; framework: FrameworkKey },
  ) => {
    if (!organization) return;

    createProject.mutate(
      {
        organizationId: organization.id,
        name: data.name,
        teamId: data.teamId === "NEW" ? undefined : data.teamId,
        newTeamName: data.newTeamName,
        language: data.language,
        framework: data.framework,
      },
      {
        onSuccess: (result) => {
          // Invalidate queries so project appears immediately in lists
          void queryClient.organization.getAll.invalidate();
          void queryClient.limits.getUsage.invalidate();
          void queryClient.team.getTeamsWithMembers.invalidate();

          trackEvent("project_created", {
            project_slug: result.projectSlug,
            language: data.language,
            framework: data.framework,
          });

          toaster.create({
            title: "Project Created",
            description: `Successfully created ${result.projectSlug}`,
            type: "success",
            meta: { closable: true },
          });

          if (navigateOnCreate) {
            void router.push(`/${result.projectSlug}`);
            return; // Don't call handleClose() - we're navigating away
          }

          handleClose();
        },
        onError: (error) => {
          toaster.create({
            title: "Error creating project",
            description: error.message,
            type: "error",
            meta: { closable: true },
          });
        },
      },
    );
  };

  return (
    <Drawer.Root
      open={open}
      placement="end"
      size="lg"
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen) {
          handleClose();
        }
      }}
    >
      <Drawer.Content>
        <Drawer.Header>
          <HStack>
            <Drawer.CloseTrigger onClick={handleClose} />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              Create New Project
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <ProjectForm
            onSubmit={handleSubmit}
            isLoading={createProject.isLoading}
            error={createProject.error?.message}
          />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
