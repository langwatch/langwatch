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
    members: [],
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
          id: team.id,
          name: data.name,
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
