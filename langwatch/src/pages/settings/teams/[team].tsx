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

import {
  teamRolesOptions,
  type RoleOption,
} from "../../../components/settings/TeamUserRoleField";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";

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
  return teamRolesOptions[builtInRole];
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
