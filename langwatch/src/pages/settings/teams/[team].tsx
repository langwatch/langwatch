import isEqual from "lodash-es/isEqual";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { useForm, useWatch, type SubmitHandler } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import { TeamUserRole } from "@prisma/client";
import SettingsLayout from "../../../components/SettingsLayout";
import {
  TeamForm,
  type TeamFormData,
} from "../../../components/settings/TeamForm";
import type { TeamWithProjectsAndMembersAndUsers } from "../../../server/api/routers/organization";
import { api } from "../../../utils/api";
import { toaster } from "../../../components/ui/toaster";

import {
  teamRolesOptions,
  type RoleOption,
} from "../../../components/settings/TeamUserRoleField";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";

export default function EditTeamPage() {
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

  if (!team.data) return <SettingsLayout />;

  return <EditTeam team={team.data} />;
}

function EditTeam({ team }: { team: TeamWithProjectsAndMembersAndUsers }) {
  // Get team's default role if it exists (either built-in or custom)
  const teamDefaultCustomRole = (team as any).defaultCustomRole;
  const teamBuiltInRole = (team as any).defaultRole;

  const teamDefaultRole = teamDefaultCustomRole
    ? ({
        label: teamDefaultCustomRole.name,
        value: `custom:${teamDefaultCustomRole.id}`,
        description:
          teamDefaultCustomRole.description ||
          `${
            (teamDefaultCustomRole.permissions as string[]).length
          } permissions`,
        isCustom: true,
        customRoleId: teamDefaultCustomRole.id,
      } as RoleOption)
    : teamBuiltInRole
    ? teamRolesOptions[teamBuiltInRole as TeamUserRole]
    : undefined;

  const getInitialValues = (): TeamFormData => ({
    name: team.name,
    defaultRole: teamDefaultRole,
    members: team.members.map((member) => {
      // Check if this user has a custom role assigned
      const customRoleAssignment = (team as any).customRoleMembers?.find(
        (crm: any) =>
          crm.userId === member.userId && crm.teamId === member.teamId,
      );

      const role = customRoleAssignment
        ? {
            label: customRoleAssignment.customRole.name,
            value: `custom:${customRoleAssignment.customRole.id}`,
            description:
              customRoleAssignment.customRole.description ||
              `${
                (customRoleAssignment.customRole.permissions as string[]).length
              } permissions`,
            isCustom: true,
            customRoleId: customRoleAssignment.customRole.id,
          }
        : teamRolesOptions[member.role];

      return {
        userId: {
          label: `${member.user.name} (${member.user.email})`,
          value: member.user.id,
        },
        role,
        saved: true,
      };
    }),
  });

  const [defaultValues, setDefaultValues] = useState<TeamFormData>(
    getInitialValues(),
  );

  const form = useForm({
    defaultValues,
  });

  // Reset form when team data changes (e.g., on refresh/reload)
  useEffect(() => {
    const newValues = getInitialValues();
    setDefaultValues(newValues);
    form.reset(newValues);
  }, [
    team.id,
    team.name,
    (team as any).defaultCustomRole?.id,
    (team as any).defaultRole,
  ]);
  const { handleSubmit, control } = form;
  const formWatch = useWatch({ control });
  const updateTeam = api.team.update.useMutation();
  const apiContext = api.useContext();

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
        },
      );
    },
    250,
  );

  useEffect(() => {
    void handleSubmit(onSubmit)();
  }, [formWatch, handleSubmit, onSubmit]);

  return (
    <SettingsLayout>
      <TeamForm
        organizationId={team.organizationId}
        team={team}
        form={form}
        onSubmit={onSubmit}
        isLoading={updateTeam.isLoading}
      />
    </SettingsLayout>
  );
}
