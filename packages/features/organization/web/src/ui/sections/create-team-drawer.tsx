import type React from "react";
import { useCallback } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { TeamUserRole } from "../../model/prisma-types";
import { useDrawer } from "../../behavior/use-drawer";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import { useRequiredSession } from "../../behavior/use-required-session";
import { api } from "../../behavior/organization-api";
import { Drawer } from "@langwatch/design-system/drawer";
import { TeamForm, type TeamFormData } from "../../ui/blocks/team-form";
import { teamRolesOptions } from "../../ui/elements/team-user-role-field";
import { useOrganizationToaster } from "../../behavior/organization-feedback";

export function CreateTeamDrawer({ open = true }: { open?: boolean }): React.ReactElement {
  const toaster = useOrganizationToaster();
  const { organization } = useOrganizationTeamProject();
  const { data: session } = useRequiredSession();
  const { closeDrawer } = useDrawer();
  const queryClient = api.useUtils();

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
            void queryClient.team.getTeamsWithRoleBindings.invalidate();
            void queryClient.team.getTeamsWithMembers.invalidate();
            toaster.create({
              title: "Team created successfully",
              type: "success",
              duration: 5000,
            });
            closeDrawer();
          },
          onError: () => {
            toaster.create({
              title: "Failed to create team",
              type: "error",
              duration: 5000,
            });
          },
        },
      );
    },
    [createTeam, organization, queryClient, closeDrawer],
  );

  return (
    <Drawer.Root
      open={open}
      placement="end"
      size="lg"
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen) closeDrawer();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.CloseTrigger onClick={closeDrawer} />
        </Drawer.Header>
        <Drawer.Body>
          {organization && (
            <TeamForm
              organizationId={organization.id}
              form={form}
              onSubmit={onSubmit}
              isLoading={createTeam.isPending}
            />
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
