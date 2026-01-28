import { TeamUserRole } from "@prisma/client";
import { useRouter } from "next/router";
import { useCallback, useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import SettingsLayout from "../../../components/SettingsLayout";
import {
  TeamForm,
  type TeamFormData,
} from "../../../components/settings/TeamForm";
import { teamRolesOptions } from "../../../components/settings/TeamUserRoleField";
import { toaster } from "../../../components/ui/toaster";
import { UpgradeModal } from "../../../components/UpgradeModal";
import { useLicenseEnforcement } from "../../../hooks/useLicenseEnforcement";
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
  const router = useRouter();

  // License enforcement for teams
  const { limitInfo: teamsLimitInfo } = useLicenseEnforcement("teams");
  const [showTeamsLimitModal, setShowTeamsLimitModal] = useState(false);

  const createTeam = api.team.createTeamWithMembers.useMutation();

  const onSubmit: SubmitHandler<TeamFormData> = useCallback(
    (data: TeamFormData) => {
      // Validate teams limit before creating
      if (
        teamsLimitInfo &&
        !teamsLimitInfo.allowed
      ) {
        setShowTeamsLimitModal(true);
        return;
      }

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
              description:
                "Please check your permissions if you have team:create permissions to create a team",
              type: "error",
              duration: 5000,
              meta: {
                closable: true,
              },
            });
          },
        },
      );
    },
    [createTeam, organization.id, router, teamsLimitInfo],
  );

  return (
    <SettingsLayout>
      <TeamForm
        organizationId={organization.id}
        form={form}
        onSubmit={onSubmit}
        isLoading={createTeam.isLoading}
      />
      
      {/* Upgrade modal for teams limit */}
      <UpgradeModal
        open={showTeamsLimitModal}
        onClose={() => setShowTeamsLimitModal(false)}
        limitType="teams"
        current={teamsLimitInfo?.current ?? 0}
        max={teamsLimitInfo?.max ?? 0}
      />
    </SettingsLayout>
  );
}
