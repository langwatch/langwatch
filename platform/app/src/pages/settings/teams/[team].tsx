import {
  Button,
  Card,
  Heading,
  HStack,
  Separator,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { TRPCClientError } from "@trpc/client";
import isEqual from "lodash-es/isEqual";
import { useCallback, useEffect, useState } from "react";
import { type SubmitHandler, useForm, useWatch } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import { PermissionAlert } from "~/components/PermissionAlert";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { showErrorToast } from "~/features/errors";
import type { TeamUserRole } from "~/generated/prisma/client";
import { useRouter } from "~/utils/compat/next-router";
import { ConfirmDialog } from "../../../components/gateway/ConfirmDialog";
import SettingsLayout from "../../../components/SettingsLayout";
import {
  TeamForm,
  type TeamFormData,
} from "../../../components/settings/TeamForm";
import {
  type RoleOption,
  teamRolesOptions,
} from "../../../components/settings/TeamUserRoleField";
import { toaster } from "../../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import type { TeamWithProjectsAndMembersAndUsers } from "../../../server/app-layer/organizations/repositories/organization.repository";
import { api } from "../../../utils/api";
import { isHandledByGlobalHandler } from "../../../utils/trpcError";

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
  return (
    Array.isArray(permissions) &&
    permissions.every((p) => typeof p === "string")
  );
}

// Helper function to convert a member's role to form data
function memberToRoleFormOption(
  assignedRole: unknown,
  builtInRole: TeamUserRole,
): RoleOption {
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
function teamMemberToFormMember(
  member: TeamWithProjectsAndMembersAndUsers["members"][number],
) {
  return {
    userId: {
      label: `${member.user.name} (${member.user.email})`,
      value: member.user.id,
    },
    role: memberToRoleFormOption(member.assignedRole, member.role),
    saved: true,
  };
}

function EditTeamPage() {
  const router = useRouter();
  const teamSlug = router.query.team;
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
    if (
      error instanceof TRPCClientError &&
      error.data?.code === "UNAUTHORIZED"
    ) {
      return (
        <SettingsLayout>
          <VStack paddingX={4} paddingY={6} gap={4} align="start">
            <PermissionAlert
              permission="team:view"
              message="You don't have permission to view this team. Please contact your team administrator for access."
            />
          </VStack>
        </SettingsLayout>
      );
    }
  }

  // Handle loading state
  if (team.isLoading || !team.data) {
    return (
      <SettingsLayout>
        <VStack
          paddingX={4}
          paddingY={6}
          gap={6}
          width="full"
          maxWidth="920px"
          align="start"
        >
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
      </SettingsLayout>
    );
  }

  return <EditTeam team={team.data} />;
}

function EditTeam({ team }: { team: TeamWithProjectsAndMembersAndUsers }) {
  const getInitialValues = useCallback(
    (teamData: TeamWithProjectsAndMembersAndUsers): TeamFormData => ({
      name: teamData.name,
      members: teamData.members.map(teamMemberToFormMember),
    }),
    [],
  );

  const [defaultValues, setDefaultValues] = useState<TeamFormData>(
    getInitialValues(team),
  );

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
  const router = useRouter();

  /** The status code of a tRPC failure, when it carries one. */
  function trpcErrorCode(error: unknown): string | undefined {
    return error instanceof TRPCClientError
      ? (error.data?.code as string | undefined)
      : undefined;
  }

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

    if (isHandledByGlobalHandler(error)) return;

    const code = trpcErrorCode(error);

    // The server rejects some edits on their merits rather than on the caller's
    // permissions, and says what to do instead. A FORBIDDEN here is only ever
    // raised by the personal-workspace guards, and its message is a sentence
    // written for the customer; RBAC failures arrive as UNAUTHORIZED.
    if (code === "FORBIDDEN") {
      toaster.create({
        title: (error as TRPCClientError<never>).message, // no-raw-error-toast-ok
        type: "error",
        duration: 8000,
        meta: { closable: true },
      });
      return;
    }

    if (code === "UNAUTHORIZED") {
      toaster.create({
        title:
          "You need to be an administrator of the organization to update this team",
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });
    }
  }

  const onSubmit: SubmitHandler<TeamFormData> = useDebouncedCallback(
    (data: TeamFormData) => {
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
              meta: {
                closable: true,
              },
            });
            void apiContext.organization.getAll.refetch();
          },
          onError: reportTeamSaveFailure,
        },
      );
    },
    250,
  );

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
          void router.push("/settings/teams");
        },
        onError: (error) => {
          if (isHandledByGlobalHandler(error)) return;
          const refused =
            error instanceof TRPCClientError &&
            error.data?.code === "FORBIDDEN";
          if (!refused) {
            showErrorToast({ error, fallbackTitle: "Failed to archive team" });
            return;
          }
          toaster.create({
            // Same as the save path: a FORBIDDEN here is our own guard
            // refusing to archive a personal workspace, and its message is
            // the sentence explaining why.
            title: error.message, // no-raw-error-toast-ok
            type: "error",
            duration: 8000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  return (
    <SettingsLayout>
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
                    Hides the team and all its projects. Contact LangWatch
                    support to restore it.
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
    </SettingsLayout>
  );
}
export default withPermissionGuard("team:view", {
  layoutComponent: SettingsLayout,
})(EditTeamPage);
