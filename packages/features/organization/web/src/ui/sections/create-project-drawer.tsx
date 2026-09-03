/**
 * `createProject`, as the address spells it.
 *
 * RECOVERED FROM `platform/app/src/components/projects/CreateProjectDrawer.tsx`,
 * deleted in `cc91631cd8`. Three live surfaces kept writing the address after
 * the component went — the Teams page's header button and its per-team "+ New
 * Project", the team form, and the CLI-auth screen's "create one now" — so
 * every one of them changed the URL and opened nothing.
 *
 * IT SITS BESIDE `create-team-drawer.tsx` for the reason that file states of
 * itself: the drawer is not a page, so it carries the address rather than
 * answering one, and everything it asks for — the organization in scope, the
 * teams under it, the navigator, the toaster — is already this family's.
 *
 * TWO THINGS CHANGED IN THE LIFT, both because they were the application's:
 *
 * - `trackEvent("project_created", …)` wrote straight to `window.gtag`. The
 *   application owns its analytics client now, and it fans a single emit out to
 *   every provider configured for the deployment rather than to gtag alone.
 * - `window.location.href = "/<slug>"` was a hard redirect. It stays a hard
 *   navigation through the host's `navigate`, because that is what the comment
 *   asked for and why: a fresh document is what guarantees the new project's
 *   graph is read rather than served from the cache the old one filled.
 *
 * NO TOAST ON FAILURE, deliberately, and the reason is in `ProjectForm`: a
 * failed create is a state that is still true rather than a moment that has
 * passed, so the form renders it inline where the reader is looking.
 */

import { Heading } from "@chakra-ui/react";
import type React from "react";
import { useAnalytics } from "react-contextual-analytics";

import { Drawer } from "@langwatch/design-system/drawer";

import { useOrganizationToaster } from "../../behavior/organization-feedback";
import { api } from "../../behavior/organization-api";
import { useDrawer } from "../../behavior/use-drawer";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import { useOrganizationHost } from "../../model/organization-host";
import { NEW_TEAM_VALUE } from "../../model/project-form-validation";
import { ProjectForm, type ProjectFormData } from "../blocks/project-form";

/** Every list a freshly created project has to show up in right away. */
function invalidateProjectListQueries(utils: ReturnType<typeof api.useUtils>): void {
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
  /**
   * Required for creating projects in a different organization via the dropdown
   * menu. When the reader clicks "New Project" under Org B while viewing Org A,
   * this is what puts the project in Org B rather than in the current context.
   */
  organizationId?: string;
  /**
   * Fires on successful creation (before the drawer closes) so embedding
   * surfaces without an ambient project — the CLI authorize page — can adopt
   * the new project, for example by selecting it in a picker once lists refresh.
   */
  onCreated?: (result: { projectSlug: string }) => void;
}): React.ReactElement {
  const { organization: currentOrganization } = useOrganizationTeamProject();
  const host = useOrganizationHost();
  const toaster = useOrganizationToaster();
  const { emit } = useAnalytics();

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

  const handleSubmit = (data: ProjectFormData & { language: string; framework: string }) => {
    if (!effectiveOrganizationId) return;

    // Safety net: if the form's teamId is empty but the caller passed a
    // defaultTeamId (the Teams page's "+ New Project" under an organization
    // with a default team), honour it. This complements the ProjectForm
    // defaultValues seed and covers the race where useForm momentarily holds
    // the "" before the seed lands.
    const resolvedTeamId =
      data.teamId === NEW_TEAM_VALUE ? undefined : data.teamId || defaultTeamId;

    createProject.mutate(
      {
        organizationId: effectiveOrganizationId,
        name: data.name,
        ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
        ...(data.newTeamName ? { newTeamName: data.newTeamName } : {}),
        language: data.language,
        framework: data.framework,
      },
      {
        onSuccess: (result) => {
          invalidateProjectListQueries(queryClient);

          emit("created", "project", {
            project_slug: result.projectSlug,
            language: data.language,
            framework: data.framework,
          });

          toaster.create({
            title: "Project Created",
            description: `Successfully created ${result.projectSlug}`,
            type: "success",
          });

          onCreated?.({ projectSlug: result.projectSlug });

          if (navigateOnCreate) {
            host.navigate(`/${result.projectSlug}`);
            return;
          }

          handleClose();
        },
        // No toast: `ProjectForm` renders `<HandledErrorAlert>` for this same
        // error. A failed create is a state that is still true, not a moment
        // that just passed, so the inline alert is the right surface.
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
            {...(defaultTeamId ? { defaultTeamId } : {})}
            {...(effectiveOrganizationId ? { organizationId: effectiveOrganizationId } : {})}
          />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
