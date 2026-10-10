/** Create-project drawer: inline error (no toast); an aggregate opens on its entry path. */

import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { Drawer } from "@langwatch/design-system/drawer";
import type { UiCreateProjectDrawerProps } from "@langwatch/organization-contract";
import {
  isAggregateProjectRouteRefused,
  PROJECT_KIND,
  projectEntryPath,
  type AggregateRule,
} from "@langwatch/project-contract";
import type React from "react";

import { api } from "../../behavior/organization-api.ts";
import { useOrganizationToaster } from "../../behavior/organization-feedback.ts";
import { useDrawer } from "../../behavior/use-drawer.ts";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project.ts";
import { useOrganizationHost } from "../../model/organization-host.ts";
import { NEW_TEAM_VALUE } from "../../model/project-form-validation.ts";
import { aggregateRuleOf } from "./aggregate-member-picker.tsx";
import { ProjectForm, type ProjectFormData } from "./project-form.tsx";

/** Every list a freshly created project has to show up in right away. */
function invalidateProjectListQueries(utils: ReturnType<typeof api.useUtils>): void {
  void utils.organization.getAll.invalidate();
  void utils.organization.getScopeGraph.invalidate();
  void utils.limits.getUsage.invalidate();
  void utils.team.getTeamWithMembers.invalidate();
  void utils.team.getTeamsWithGrants.invalidate();
}

/**
 * The server's rule (ADR-177 decision 5), asked of the caller's role in the
 * organization the project is created in, which need not be the one viewed.
 */
function canCreateAggregateIn({
  organizations,
  organizationId,
}: {
  organizations: { id: string; members: { role: string }[] }[] | undefined;
  organizationId: string | undefined;
}): boolean {
  const organization = organizations?.find((candidate) => candidate.id === organizationId);
  // `organization.getAll` narrows `members` to the caller's own row.
  return !isAggregateProjectRouteRefused({
    kind: PROJECT_KIND.AGGREGATE,
    organizationRole: organization?.members[0]?.role,
  });
}

/** The kind fields of the create request: none unless Governance is checked. */
function aggregateFieldsOf(data: ProjectFormData): {
  kind?: typeof PROJECT_KIND.AGGREGATE;
  aggregateRule?: AggregateRule;
} {
  if (!data.isAggregate) return {};
  return {
    kind: PROJECT_KIND.AGGREGATE,
    aggregateRule: aggregateRuleOf(data.aggregateMembers),
  };
}

export function CreateProjectDrawer({
  open = true,
  onClose,
  navigateOnCreate = false,
  defaultTeamId,
  organizationId: organizationIdProp,
  onCreated,
}: UiCreateProjectDrawerProps): React.ReactElement {
  const { organization: currentOrganization } = useOrganizationTeamProject();
  const organizations = api.organization.getAll.useQuery({ isDemo: false });
  const host = useOrganizationHost();
  const toaster = useOrganizationToaster();
  const analytics = useUiAnalytics();

  const effectiveOrganizationId = organizationIdProp ?? currentOrganization?.id;
  const canCreateAggregate = canCreateAggregateIn({
    organizations: organizations.data,
    organizationId: effectiveOrganizationId,
  });
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
        ...aggregateFieldsOf(data),
      },
      {
        onSuccess: (result) => {
          invalidateProjectListQueries(queryClient);

          analytics.track({
            action: "created",
            name: "project",
            attributes: {
              project_slug: result.projectSlug,
              language: data.language,
              framework: data.framework,
            },
          });

          toaster.create({
            title: "Project Created",
            description: `Successfully created ${result.projectSlug}`,
            type: "success",
          });

          onCreated?.({ projectSlug: result.projectSlug });

          if (navigateOnCreate) {
            host.navigate(
              projectEntryPath({ slug: result.projectSlug, kind: aggregateFieldsOf(data).kind }),
            );
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
          <Drawer.Title>Create New Project</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body>
          <ProjectForm
            onSubmit={handleSubmit}
            isLoading={createProject.isPending}
            error={createProject.error}
            {...(defaultTeamId ? { defaultTeamId } : {})}
            {...(effectiveOrganizationId ? { organizationId: effectiveOrganizationId } : {})}
            canCreateAggregate={canCreateAggregate}
          />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
