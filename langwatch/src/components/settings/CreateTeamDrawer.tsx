import { Heading } from "@chakra-ui/react";
import { TeamUserRole } from "@prisma/client";
import type React from "react";
import { useCallback } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { useDrawer } from "../../hooks/useDrawer";
import { useLicenseEnforcement } from "../../hooks/useLicenseEnforcement";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import { api } from "../../utils/api";
import { Drawer } from "../ui/drawer";
import { toaster } from "../ui/toaster";
import { TeamForm, type TeamFormData } from "./TeamForm";
import { teamRolesOptions } from "./TeamUserRoleField";

export function CreateTeamDrawer({ open = true }: { open?: boolean }): React.ReactElement {
  const { organization } = useOrganizationTeamProject();
  const { data: session } = useRequiredSession();
  const { closeDrawer } = useDrawer();
  const queryClient = api.useContext();
  const { checkAndProceed } = useLicenseEnforcement("teams");

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
      checkAndProceed(() => {
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
                meta: { closable: true },
              });
              closeDrawer();
            },
            onError: () => {
              toaster.create({
                title: "Failed to create team",
                type: "error",
                duration: 5000,
                meta: { closable: true },
              });
            },
          },
        );
      });
    },
    [createTeam, organization, queryClient, closeDrawer, checkAndProceed],
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
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.CloseTrigger onClick={closeDrawer} />
          <Heading>Create New Team</Heading>
        </Drawer.Header>
        <Drawer.Body>
          {organization && (
            <TeamForm
              organizationId={organization.id}
              form={form}
              onSubmit={onSubmit}
              isLoading={createTeam.isLoading}
            />
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
