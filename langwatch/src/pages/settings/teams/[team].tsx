import type { TeamUserRole } from "@prisma/client";
import isEqual from "lodash-es/isEqual";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, useWatch, type SubmitHandler } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import SettingsLayout from "../../../components/SettingsLayout";
import {
  TeamForm,
  type TeamFormData,
} from "../../../components/settings/TeamForm";
import { toaster } from "../../../components/ui/toaster";
import type { TeamWithProjectsAndMembersAndUsers } from "../../../server/api/routers/organization";
import { api } from "../../../utils/api";

import { teamRolesOptions } from "../../../components/settings/TeamUserRoleField";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";

// Type guards for safe access to custom role data
function isValidCustomRoleMember(
  member: unknown,
): member is TeamWithProjectsAndMembersAndUsers["customRoleMembers"][0] {
  return (
    typeof member === "object" &&
    member !== null &&
    "customRole" in member &&
    typeof (member as { customRole: unknown }).customRole === "object" &&
    (member as { customRole: unknown }).customRole !== null
  );
}

function isValidPermissions(permissions: unknown): permissions is string[] {
  return (
    Array.isArray(permissions) &&
    permissions.every((p) => typeof p === "string")
  );
}

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
  // Get team's default role if it exists (built-in only)
  const teamBuiltInRole = team.defaultRole;

  const teamDefaultRole = useMemo(() => {
    return teamBuiltInRole
      ? teamRolesOptions[teamBuiltInRole as TeamUserRole]
      : undefined;
  }, [teamBuiltInRole]);

  const getInitialValues = useCallback(
    (teamData: TeamWithProjectsAndMembersAndUsers): TeamFormData => ({
      name: teamData.name,
      defaultRole: teamDefaultRole,
      members: teamData.members.map((member) => {
        // Check if this user has a custom role assigned
        const customRoleAssignment = teamData.customRoleMembers?.find(
          (crm) => crm.userId === member.userId && crm.teamId === member.teamId,
        );

        const role =
          customRoleAssignment && isValidCustomRoleMember(customRoleAssignment)
            ? {
                label: customRoleAssignment.customRole.name,
                value: `custom:${customRoleAssignment.customRole.id}`,
                description:
                  customRoleAssignment.customRole.description ??
                  (isValidPermissions(
                    customRoleAssignment.customRole.permissions,
                  )
                    ? `${customRoleAssignment.customRole.permissions.length} permissions`
                    : "Custom role"),
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
    }),
    [teamDefaultRole],
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
