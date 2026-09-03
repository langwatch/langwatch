/**
 * One team, at `/settings/teams/:team`.
 *
 * THE EDIT FORM AND THE ARCHIVE, over one read. Everything the form saves goes
 * in ONE mutation, so a rename and a membership change cannot half-apply, and
 * archiving the team leaves for the list rather than sitting on a page whose
 * subject is gone.
 */

import { Button, Card, Heading, HStack, Separator, Skeleton, Text, VStack } from "@chakra-ui/react";
import { isEqual } from "lodash-es";
import { useCallback, useEffect, useState } from "react";
import { type SubmitHandler, useForm, useWatch } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import { trpcErrorCode, trpcErrorMessage } from "../../model/trpc-error";
import { PermissionAlert } from "../../ui/elements/permission-alert";
import type { TeamUserRole } from "../../model/prisma-types";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { TeamForm, type TeamFormData } from "../../ui/blocks/team-form";
import { type RoleOption, teamRolesOptions } from "../../ui/elements/team-user-role-field";
import { useOrganizationHost } from "../../model/organization-host";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import { api, type RouterOutputs } from "../../behavior/organization-api";

/**
 * One team as this page reads it: whatever `team.getTeamWithMembers` answers.
 * Taken off the seam rather than off the Prisma model, because the procedure
 * serves a browser-shaped team (no accounting columns) plus its projects.
 */
type TeamWithProjectsAndMembers = RouterOutputs["team"]["getTeamWithMembers"];
import { useOrganizationToaster, useShowErrorToast } from "../../behavior/organization-feedback";

// Type guards for safe access to custom role data
function isValidCustomRole(role: unknown): role is {
  id: string;
  name: string;
  description: string | null;
  permissions: unknown;
} {
  return (
    typeof role === "object" &&
    role !== null &&
    "id" in role &&
    "name" in role &&
    typeof (role as { id: unknown }).id === "string" &&
    typeof (role as { name: unknown }).name === "string"
  );
}

function isValidPermissions(permissions: unknown): permissions is string[] {
  return Array.isArray(permissions) && permissions.every((p) => typeof p === "string");
}

// Helper function to convert a member's role to form data
function memberToRoleFormOption(assignedRole: unknown, builtInRole: TeamUserRole): RoleOption {
  if (assignedRole && isValidCustomRole(assignedRole)) {
    return {
      label: assignedRole.name,
      value: `custom:${assignedRole.id}`,
      description:
        assignedRole.description ??
        (isValidPermissions(assignedRole.permissions)
          ? `${assignedRole.permissions.length} permissions`
          : "Custom role"),
      isCustom: true,
      customRoleId: assignedRole.id,
    } as RoleOption;
  }
  return teamRolesOptions[builtInRole as keyof typeof teamRolesOptions];
}

// Helper function to convert team member to form member
function teamMemberToFormMember(member: TeamWithProjectsAndMembers["members"][number]) {
  return {
    userId: {
      label: `${member.user.name} (${member.user.email})`,
      value: member.user.id,
    },
    role: memberToRoleFormOption(member.assignedRole, member.role),
    saved: true,
  };
}

/** The grant the platform page asked for, unchanged. */
export const TEAM_DETAIL_PAGE_PERMISSION = "team:view";

export default function TeamDetailScreen() {
  const host = useOrganizationHost();
  const teamSlug = host.route().params.team;
  const { organization } = useOrganizationTeamProject();
  const team = api.team.getTeamWithMembers.useQuery(
    {
      slug: teamSlug as string,
      organizationId: organization?.id ?? "",
    },
    { enabled: typeof teamSlug === "string" && !!organization?.id },
  );

  // Handle UNAUTHORIZED error first
  if (team.error) {
    const error = team.error;
    if (trpcErrorCode(error) === "UNAUTHORIZED") {
      return (
        <VStack paddingX={4} paddingY={6} gap={4} align="start">
          <PermissionAlert
            permission="team:view"
            message="You don't have permission to view this team. Please contact your team administrator for access."
          />
        </VStack>
      );
    }
  }

  // Handle loading state
  if (team.isLoading || !team.data) {
    return (
      <VStack paddingX={4} paddingY={6} gap={6} width="full" maxWidth="920px" align="start">
        <HStack gap="8px">
          <Skeleton height="20px" width="60px" />
          <Skeleton height="20px" width="12px" />
          <Skeleton height="20px" width="120px" />
        </HStack>
        <Skeleton height="32px" width="200px" />
        <Card.Root width="full">
          <Card.Body paddingY={4}>
            <VStack gap={4} align="start">
              <VStack gap={2} align="start" width="full">
                <Skeleton height="16px" width="80px" />
                <Skeleton height="40px" width="full" />
              </VStack>
              <VStack gap={2} align="start" width="full">
                <Skeleton height="16px" width="100px" />
                <Skeleton height="40px" width="full" />
              </VStack>
            </VStack>
          </Card.Body>
        </Card.Root>
      </VStack>
    );
  }

  return <EditTeam team={team.data} />;
}

function EditTeam({ team }: { team: TeamWithProjectsAndMembers }) {
  const toaster = useOrganizationToaster();
  const showErrorToast = useShowErrorToast();
  const getInitialValues = useCallback(
    (teamData: TeamWithProjectsAndMembers): TeamFormData => ({
      name: teamData.name,
      members: teamData.members.map(teamMemberToFormMember),
    }),
    [],
  );

  const [defaultValues, setDefaultValues] = useState<TeamFormData>(getInitialValues(team));

  const form = useForm({
    defaultValues,
  });

  // Reset form when team data changes (e.g., on refresh/reload)
  useEffect(() => {
    const newValues = getInitialValues(team);
    setDefaultValues(newValues);
    form.reset(newValues);
  }, [team, getInitialValues, form]);
  const { handleSubmit, control } = form;
  const formWatch = useWatch({ control });
  const updateTeam = api.team.update.useMutation();
  const archiveTeam = api.team.archiveById.useMutation();
  const apiContext = api.useUtils();
  const host = useOrganizationHost();

  /**
   * The baseline moves to the submitted values before the mutation answers, so
   * a save the server rejected would otherwise stay on screen as the local
   * truth: the form shows membership that was never written, and every later
   * autosave resubmits it, so even a rename can no longer land. Rolling both
   * the baseline and the form back to the team's persisted values puts the
   * refused edit where the server left it.
   */
  function restorePersistedTeamValues(): void {
    const persisted = getInitialValues(team);
    setDefaultValues(persisted);
    form.reset(persisted);
  }

  /**
   * Saving is autosaved and debounced, so a failure nobody surfaces is a change
   * that silently did not happen.
   */
  function reportTeamSaveFailure(error: unknown): void {
    restorePersistedTeamValues();

    const code = trpcErrorCode(error);

    // The server rejects some edits on their merits rather than on the caller's
    // permissions, and says what to do instead. A FORBIDDEN here is only ever
    // raised by the personal-workspace guards, and its message is a sentence
    // written for the customer; RBAC failures arrive as UNAUTHORIZED.
    if (code === "FORBIDDEN") {
      toaster.create({
        title: trpcErrorMessage(error) ?? "That change was refused", // no-raw-error-toast-ok
        type: "error",
        duration: 8000,
      });
      return;
    }

    if (code === "UNAUTHORIZED") {
      toaster.create({
        title: "You need to be an administrator of the organization to update this team",
        type: "error",
        duration: 5000,
      });
      return;
    }

    // Everything else renders its registry copy, or the fallback headline. An
    // autosave that reverts the form with no word at all reads as the change
    // simply not sticking — the last-admin refusal used to land here silently.
    showErrorToast({ error, fallbackTitle: "Couldn't update this team" });
  }

  const onSubmit: SubmitHandler<TeamFormData> = useDebouncedCallback((data: TeamFormData) => {
    if (isEqual(data, defaultValues)) return;

    setDefaultValues(data);

    updateTeam.mutate(
      {
        teamId: team.id,
        name: data.name,
        members: data.members.map((member) => ({
          userId: member.userId?.value ?? "",
          role: member.role.value,
          customRoleId: member.role.customRoleId,
        })),
      },
      {
        onSuccess: () => {
          toaster.create({
            title: "Team updated successfully",
            type: "success",
            duration: 2000,
          });
          void apiContext.organization.getAll.refetch();
        },
        onError: reportTeamSaveFailure,
      },
    );
  }, 250);

  useEffect(() => {
    void handleSubmit(onSubmit)();
  }, [formWatch, handleSubmit, onSubmit]);

  const [showArchiveDialog, setShowArchiveDialog] = useState(false);

  const handleArchive = () => {
    archiveTeam.mutate(
      { teamId: team.id },
      {
        onSuccess: () => {
          setShowArchiveDialog(false);
          host.navigate("/settings/teams");
        },
        onError: (error: unknown) => {
          const refused = trpcErrorCode(error) === "FORBIDDEN";
          if (!refused) {
            showErrorToast({ error, fallbackTitle: "Failed to archive team" });
            return;
          }
          toaster.create({
            // Same as the save path: a FORBIDDEN here is our own guard
            // refusing to archive a personal workspace, and its message is
            // the sentence explaining why.
            title: trpcErrorMessage(error) ?? "That team could not be archived", // no-raw-error-toast-ok
            type: "error",
            duration: 8000,
          });
        },
      },
    );
  };

  return (
    <>
      <VStack gap={8} align="start" width="full">
        <TeamForm
          organizationId={team.organizationId}
          team={team}
          form={form}
          onSubmit={onSubmit}
          isLoading={updateTeam.isPending}
        />
        <Separator />
        <VStack align="start" gap={3} width="full">
          <Heading size="sm" color="red.500">
            Danger Zone
          </Heading>
          <Card.Root width="full" borderColor="red.200">
            <Card.Body>
              <HStack justify="space-between">
                <VStack align="start" gap={0}>
                  <Text fontWeight="medium">Archive this team</Text>
                  <Text fontSize="sm" color="fg.muted">
                    Hides the team and all its projects. Contact LangWatch support to restore it.
                  </Text>
                </VStack>
                <Button
                  colorPalette="red"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowArchiveDialog(true)}
                  disabled={archiveTeam.isPending}
                >
                  Archive team
                </Button>
              </HStack>
            </Card.Body>
          </Card.Root>
        </VStack>
      </VStack>
      <ConfirmDialog
        open={showArchiveDialog}
        onOpenChange={(open) => {
          if (!open) setShowArchiveDialog(false);
        }}
        title="Archive Team"
        message={`Are you sure you want to archive "${team.name}"? This will hide the team and all its projects. Contact LangWatch support to restore it.`}
        confirmLabel="Archive"
        tone="danger"
        loading={archiveTeam.isPending}
        onConfirm={handleArchive}
      />
    </>
  );
}
