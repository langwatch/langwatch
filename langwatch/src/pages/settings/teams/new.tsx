import { useToast } from "@chakra-ui/react";
import { TeamUserRole } from "@prisma/client";
import { useRouter } from "next/router";
import { useCallback } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
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
  const toast = useToast();
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
            toast({
              title: "Team created successfully",
              status: "success",
              duration: 5000,
              isClosable: true,
            });
            void router.push(`/settings/teams`);
          },
          onError: () => {
            toast({
              title: "Failed to create team",
              description: "Please try again",
              status: "error",
              duration: 5000,
              isClosable: true,
            });
          },
        }
      );
    },
    [createTeam, organization.id, router, toast]
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
