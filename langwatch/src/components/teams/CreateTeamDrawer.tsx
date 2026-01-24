import { HStack } from "@chakra-ui/react";
import { TeamUserRole } from "@prisma/client";
import type React from "react";
import { useCallback } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { TOAST_DURATION_MS } from "../../constants/ui";
import { useDrawerCloseCallback } from "../../hooks/useDrawerCloseCallback";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import { api } from "../../utils/api";
import { TeamForm, type TeamFormData } from "../settings/TeamForm";
import { teamRolesOptions } from "../settings/TeamUserRoleField";
import { Drawer } from "../ui/drawer";
import { toaster } from "../ui/toaster";

const TOAST_MESSAGES = {
  success: {
    title: "Team created successfully",
  },
  error: {
    title: "Failed to create team",
    defaultDescription:
      "Please check your permissions if you have team:create permissions to create a team",
  },
} as const;

export function CreateTeamDrawer({
  open = true,
  onClose,
}: {
  open?: boolean;
  onClose?: () => void;
}): React.ReactElement | null {
  const { organization } = useOrganizationTeamProject();
  const { data: session } = useRequiredSession();
  const handleClose = useDrawerCloseCallback(onClose);
  const queryClient = api.useContext();

  const form = useForm<TeamFormData>({
    defaultValues: {
      name: "",
      members: [
        {
          userId: {
            label: `${session?.user.name} (${session?.user.email})`,
            value: session?.user.id ?? "",
          },
          role: teamRolesOptions[TeamUserRole.ADMIN],
          saved: false,
        },
      ],
    },
  });

  const createTeam = api.team.createTeamWithMembers.useMutation();

  const onSubmit: SubmitHandler<TeamFormData> = useCallback(
    (data: TeamFormData) => {
      if (!organization) return;

      createTeam.mutate(
        {
          name: data.name,
          organizationId: organization.id,
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

            handleClose();
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
    [createTeam, organization, queryClient.team.getTeamsWithMembers, handleClose],
  );

  if (!organization) return null;

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
        </Drawer.Header>
        <Drawer.Body>
          <TeamForm
            organizationId={organization.id}
            form={form}
            onSubmit={onSubmit}
            isLoading={createTeam.isLoading}
          />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
