import isEqual from "lodash.isequal";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { useForm, useWatch, type SubmitHandler } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import SettingsLayout from "../../../components/SettingsLayout";
import {
  TeamForm,
  type TeamFormData,
} from "../../../components/settings/TeamForm";
import type { TeamWithMembersAndProjects } from "../../../server/api/routers/organization";
import { api } from "../../../utils/api";
import { teamRolesOptions } from "../../../components/settings/TeamUserRoleField";

export default function EditTeamPage() {
  const router = useRouter();
  const teamSlug = router.query.team;
  const team = api.team.getTeamWithMembers.useQuery(
    {
      slug: teamSlug as string,
    },
    { enabled: typeof teamSlug === "string" }
  );

  if (!team.data) return <SettingsLayout />;

  return <EditTeam team={team.data} />;
}

function EditTeam({ team }: { team: TeamWithMembersAndProjects }) {
  const [defaultValues, setDefaultValues] = useState<TeamFormData>({
    name: team.name,
    members: team.members.map((member) => ({
      userId: {
        label: `${member.user.name} (${member.user.email})`,
        value: member.user.id,
      },
      role: teamRolesOptions[member.role],
      saved: true,
    })),
  });
  const form = useForm({
    defaultValues,
  });
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
          })),
        },
        {
          onSuccess: () => {
            void apiContext.organization.getAll.refetch();
          },
        }
      );
    },
    250
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
