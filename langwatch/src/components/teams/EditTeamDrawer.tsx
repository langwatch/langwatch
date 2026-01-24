import {
  Button,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { TeamUserRole } from "@prisma/client";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { TOAST_DURATION_MS } from "../../constants/ui";
import { useDrawerParams } from "../../hooks/useDrawer";
import { useDrawerCloseCallback } from "../../hooks/useDrawerCloseCallback";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { TeamForm, type TeamFormData } from "../settings/TeamForm";
import { teamRolesOptions } from "../settings/TeamUserRoleField";
import { Drawer } from "../ui/drawer";
import { toaster } from "../ui/toaster";

const TOAST_MESSAGES = {
  success: {
    title: "Team updated",
  },
  error: {
    title: "Failed to update team",
    defaultDescription: "Please try again or contact support if the problem persists",
  },
} as const;

export function EditTeamDrawer({
  open = true,
  onClose,
  teamId: propTeamId,
}: {
  open?: boolean;
  onClose?: () => void;
  teamId?: string;
}): React.ReactElement | null {
  const { organization, hasPermission } = useOrganizationTeamProject();
  const drawerParams = useDrawerParams();
  const teamId = propTeamId ?? drawerParams.teamId;
  const queryClient = api.useContext();
  const [isDirty, setIsDirty] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const performClose = useDrawerCloseCallback(onClose);

  const canManageTeam = hasPermission("team:manage");

  const teamQuery = api.team.getTeamById.useQuery(
    { teamId: teamId ?? "" },
    { enabled: !!teamId && !!organization },
  );

  const team = teamQuery.data;
  const refetchTeam = teamQuery.refetch;

  // Build form default values from team data
  const defaultValues = useMemo(() => {
    if (!team) {
      return {
        name: "",
        members: [],
      };
    }

    return {
      name: team.name,
      members: team.members.map((member) => {
        const isCustomRole = member.role === TeamUserRole.CUSTOM;
        const roleValue = isCustomRole && member.assignedRole
          ? `custom:${member.assignedRole.id}`
          : member.role;

        return {
          userId: {
            label: `${member.user.name} (${member.user.email})`,
            value: member.userId,
          },
          role: isCustomRole && member.assignedRole
            ? {
                label: member.assignedRole.name,
                value: roleValue,
                customRoleId: member.assignedRole.id,
              }
            : teamRolesOptions[member.role as keyof typeof teamRolesOptions] ?? teamRolesOptions[TeamUserRole.MEMBER],
          saved: true,
        };
      }),
    };
  }, [team]);

  const form = useForm<TeamFormData>({
    defaultValues,
  });

  // Reset form when team data loads
  useEffect(() => {
    if (team) {
      form.reset(defaultValues);
    }
  }, [team, defaultValues, form]);

  // Track dirty state
  useEffect(() => {
    const subscription = form.watch(() => {
      setIsDirty(form.formState.isDirty);
    });
    return () => subscription.unsubscribe();
  }, [form]);

  const updateTeam = api.team.update.useMutation();

  const handleClose = useCallback(() => {
    if (isDirty) {
      setShowDiscardDialog(true);
      return;
    }

    performClose();
  }, [performClose, isDirty]);

  const handleConfirmDiscard = useCallback(() => {
    setShowDiscardDialog(false);
    setIsDirty(false);
    performClose();
  }, [performClose]);

  const handleCancelDiscard = useCallback(() => {
    setShowDiscardDialog(false);
  }, []);

  const onSubmit: SubmitHandler<TeamFormData> = useCallback(
    (data: TeamFormData) => {
      if (!teamId) return;

      updateTeam.mutate(
        {
          teamId,
          name: data.name,
          members: data.members.map((member) => ({
            userId: member.userId?.value ?? "",
            role: member.role.value,
            customRoleId: member.role.customRoleId,
          })),
        },
        {
          onSuccess: () => {
            void queryClient.team.getTeamsWithMembers.invalidate();

            toaster.create({
              title: TOAST_MESSAGES.success.title,
              type: "success",
              duration: TOAST_DURATION_MS,
              meta: {
                closable: true,
              },
            });

            setIsDirty(false);
            performClose();
          },
          onError: (error) => {
            toaster.create({
              title: TOAST_MESSAGES.error.title,
              description:
                error.message || TOAST_MESSAGES.error.defaultDescription,
              type: "error",
              duration: TOAST_DURATION_MS,
              meta: {
                closable: true,
              },
            });
          },
        },
      );
    },
    [updateTeam, teamId, queryClient.team.getTeamsWithMembers, performClose],
  );

  const renderDrawerContent = useCallback(() => {
    if (teamQuery.isLoading) {
      return <LoadingSkeleton />;
    }

    if (teamQuery.error) {
      return (
        <ErrorState
          onRetry={() => void refetchTeam()}
        />
      );
    }

    if (!team) {
      return (
        <ErrorState
          message="Team not found"
          onRetry={() => void refetchTeam()}
        />
      );
    }

    return (
      <VStack gap={4} width="full" align="start">
        <TeamForm
          organizationId={organization?.id ?? ""}
          team={team}
          form={form}
          onSubmit={onSubmit}
          isLoading={updateTeam.isLoading}
          hideProjects={true}
        />
        {canManageTeam && (
          <HStack width="full" justifyContent="flex-end">
            <Button
              type="submit"
              colorPalette="orange"
              loading={updateTeam.isLoading}
              onClick={form.handleSubmit(onSubmit)}
            >
              Save Changes
            </Button>
          </HStack>
        )}
      </VStack>
    );
  }, [teamQuery.isLoading, teamQuery.error, refetchTeam, team, organization?.id, form, onSubmit, updateTeam.isLoading, canManageTeam]);

  if (!organization) return null;

  return (
    <>
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
          </Drawer.Header>
          <Drawer.Body>
            {renderDrawerContent()}
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>

      {/* Unsaved Changes Confirmation Dialog */}
      {showDiscardDialog && (
        <Drawer.Root
          open={showDiscardDialog}
          placement="end"
          size="sm"
          onOpenChange={({ open: isOpen }) => {
            if (!isOpen) {
              handleCancelDiscard();
            }
          }}
        >
          <Drawer.Content>
            <Drawer.Header>
              <Text fontWeight="bold">Discard unsaved changes?</Text>
            </Drawer.Header>
            <Drawer.Body>
              <Text>You have unsaved changes. Are you sure you want to discard them?</Text>
            </Drawer.Body>
            <Drawer.Footer gap={2}>
              <Button variant="outline" onClick={handleCancelDiscard}>
                Continue Editing
              </Button>
              <Button colorPalette="red" onClick={handleConfirmDiscard}>
                Discard Changes
              </Button>
            </Drawer.Footer>
          </Drawer.Content>
        </Drawer.Root>
      )}
    </>
  );
}

function LoadingSkeleton(): React.ReactElement {
  return (
    <VStack gap={4} width="full" align="start" data-testid="edit-team-loading">
      <Skeleton height="40px" width="200px" />
      <Skeleton height="40px" width="full" />
      <Skeleton height="20px" width="100px" />
      <Skeleton height="40px" width="full" />
      <Skeleton height="200px" width="full" />
    </VStack>
  );
}

function ErrorState({
  message = "Failed to load team data",
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <VStack gap={4} width="full" align="center" py={8}>
      <Text color="red.500">{message}</Text>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </VStack>
  );
}
