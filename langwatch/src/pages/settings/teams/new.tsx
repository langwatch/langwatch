import { useRouter } from "next/router";
import { useCallback } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { TeamUserRole } from "@prisma/client";
import SettingsLayout from "../../../components/SettingsLayout";
import {
  TeamForm,
  type TeamFormData,
} from "../../../components/settings/TeamForm";
import { teamRolesOptions } from "../../../components/settings/TeamUserRoleField";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../../../hooks/useRequiredSession";
import type { FullyLoadedOrganization } from "../../../server/api/routers/organization";
import { api } from "../../../utils/api";
import { toaster } from "../../../components/ui/toaster";

export default function NewTeamPage() {
  const { organization } = useOrganizationTeamProject();
  if (!organization) return <SettingsLayout />;

  return <NewTeam organization={organization} />;
}

function NewTeam({ organization }: { organization: FullyLoadedOrganization }) {
  const { data: session } = useRequiredSession();
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
  const router = useRouter();

  const createTeam = api.team.createTeamWithMembers.useMutation();

  const onSubmit: SubmitHandler<TeamFormData> = useCallback(
    (data: TeamFormData) => {
      createTeam.mutate(
        {
          name: data.name,
          organizationId: organization.id,
          members: data.members.map((member) => ({
            userId: member.userId?.value ?? "",
            role: member.role.value,
          })),
        },
        {
          onSuccess: () => {
            toaster.create({
              title: "Team created successfully",
              type: "success",
              duration: 5000,
              meta: {
                closable: true,
              },
            });
            void router.push(`/settings/teams`);
          },
          onError: () => {
            toaster.create({
              title: "Failed to create team",
              description: "Please try again",
              type: "error",
              duration: 5000,
              meta: {
                closable: true,
              },
            });
          },
        }
      );
    },
    [createTeam, organization.id, router]
  );

  return (
    <SettingsLayout>
      <TeamForm
        organizationId={organization.id}
        form={form}
        onSubmit={onSubmit}
        isLoading={createTeam.isLoading}
      />
    </SettingsLayout>
  );
}
