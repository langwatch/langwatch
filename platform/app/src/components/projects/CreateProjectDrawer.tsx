import { Heading } from "@chakra-ui/react";
import type React from "react";
import { useDrawer } from "../../hooks/useDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { trackEvent } from "../../utils/tracking";
import { Drawer } from "../ui/drawer";
import { toaster } from "../ui/toaster";
import { ProjectForm, type ProjectFormData } from "./ProjectForm";
import { NEW_TEAM_VALUE } from "./projectFormValidation";

/** Every list a freshly created project has to show up in right away. */
function invalidateProjectListQueries(
  utils: ReturnType<typeof api.useUtils>,
): void {
  void utils.organization.getAll.invalidate();
  void utils.limits.getUsage.invalidate();
  void utils.team.getTeamsWithMembers.invalidate();
  void utils.team.getTeamWithMembers.invalidate();
  void utils.team.getTeamsWithRoleBindings.invalidate();
}

export function CreateProjectDrawer({
  open = true,
  onClose,
  navigateOnCreate = false,
  defaultTeamId,
  organizationId: organizationIdProp,
  onCreated,
}: {
  open?: boolean;
  onClose?: () => void;
  navigateOnCreate?: boolean;
  defaultTeamId?: string;
  /** Required for creating projects in a different organization via the dropdown menu.
   * When the user clicks "New Project" under Org B while viewing Org A, this ensures
   * the project is created in Org B instead of the current context. */
  organizationId?: string;
  /** Fires on successful creation (before the drawer closes) so embedding
   * surfaces without an ambient project (the CLI authorize page) can adopt
   * the new project, e.g. select it in a picker once lists refresh. */
  onCreated?: (result: { projectSlug: string }) => void;
}): React.ReactElement {
  const { organization: currentOrganization } = useOrganizationTeamProject();

  const effectiveOrganizationId = organizationIdProp ?? currentOrganization?.id;
  const { closeDrawer } = useDrawer();
  const queryClient = api.useUtils();

  const createProject = api.project.create.useMutation();

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      closeDrawer();
    }
  };

  const handleSubmit = (
    data: ProjectFormData & { language: string; framework: string },
  ) => {
    if (!effectiveOrganizationId) return;

    // Safety net: if the form's teamId is empty but the caller passed a
    // defaultTeamId (e.g. Dashboard "+ New Project" under an org with a
    // default team), honor it. This complements the ProjectForm
    // defaultValues seed and covers the race where useForm momentarily
    // holds the "" before the seed lands.
    const resolvedTeamId =
      data.teamId === NEW_TEAM_VALUE ? undefined : data.teamId || defaultTeamId;

    createProject.mutate(
      {
        organizationId: effectiveOrganizationId,
        name: data.name,
        teamId: resolvedTeamId,
        newTeamName: data.newTeamName,
        language: data.language,
        framework: data.framework,
      },
      {
        onSuccess: (result) => {
          invalidateProjectListQueries(queryClient);

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

          onCreated?.({ projectSlug: result.projectSlug });

          if (navigateOnCreate) {
            // Use hard redirect to ensure fresh data after project creation
            window.location.href = `/${result.projectSlug}`;
            return;
          }

          handleClose();
        },
        // No toast: `ProjectForm` renders `<HandledErrorAlert>` for this
        // same error. A failed create is a state that is still true, not a
        // moment that just passed, so the inline alert is the right surface
        // — and it already carries the tips, docs link and error id.
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
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.CloseTrigger onClick={handleClose} />
          <Heading>Create New Project</Heading>
        </Drawer.Header>
        <Drawer.Body>
          <ProjectForm
            onSubmit={handleSubmit}
            isLoading={createProject.isPending}
            error={createProject.error}
            defaultTeamId={defaultTeamId}
            organizationId={effectiveOrganizationId}
          />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
