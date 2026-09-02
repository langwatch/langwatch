/**
 * `/onboarding/:team/project` — the first project a new organization creates.
 *
 * `TechStackSelector` and `ProjectFormData` are `@langwatch/project-web`'s: the
 * picker moved there with the project settings page, and `RadioCard` — which
 * used to live in THIS file and which that package imported back out of it —
 * went with it as a local element. Importing the block is what keeps the two
 * surfaces that ask "which language and framework" asking it the same way.
 */

import {
  Button,
  Field,
  Heading,
  HStack,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import { type ProjectFormData, TechStackSelector } from "@langwatch/project-web/ui/blocks/tech-stack";
import { useEffect } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { useRouter } from "../../behavior/next-router";
import { api } from "../../behavior/onboarding-api";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import { useRequiredSession } from "../../behavior/use-required-session";
import { SetupLayout } from "../../ui/elements/setup-layout";
import ErrorPage from "../../ui/elements/compat/next-error";
import { getSafeReturnToPath } from "../../model/get-safe-return-to-path";

export default function ProjectOnboarding() {
  useRequiredSession();

  const form = useForm<ProjectFormData>({
    defaultValues: {
      language: "python",
      framework: "openai",
    },
  });
  const { watch } = form;
  const teamId = watch("teamId");

  const router = useRouter();
  const { organization } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });

  const { team: teamSlug } = router.query;
  const team = api.team.getBySlug.useQuery(
    {
      slug: typeof teamSlug == "string" ? teamSlug : "",
      organizationId: organization?.id ?? "",
    },
    { enabled: !!organization },
  );
  const teams = api.team.getTeamsWithMembers.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization },
  );
  const safeReturnToPath = getSafeReturnToPath(router.query.return_to);

  useEffect(() => {
    if (team.data) {
      form.setValue("teamId", team.data.id);
    }
  }, [form, team.data]);

  const createProject = api.project.create.useMutation();

  const onSubmit: SubmitHandler<ProjectFormData> = (data: ProjectFormData) => {
    if (!team.data) return;

    createProject.mutate(
      {
        organizationId: organization?.id ?? "",
        name: data.name,
        teamId: data.teamId == "NEW" ? undefined : data.teamId,
        newTeamName: data.newTeamName,
        language: data.language,
        framework: data.framework,
      },
      {
        onSuccess: (data) => {
          if (safeReturnToPath) {
            void router.push(safeReturnToPath);
            return;
          }

          void router.push(`/${data.projectSlug}`);
        },
      },
    );
  };

  if (team.isFetched && !team.data) {
    return <ErrorPage statusCode={404} />;
  }

  return (
    <SetupLayout>
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <VStack gap={4} alignItems="left">
          <Heading as="h1" fontSize="x-large">
            Create New Project
          </Heading>
          <Text paddingBottom={4} fontSize="14px">
            You can set up separate projects for each service or LLM feature of your
            application (for example, one for your ChatBot, another for that Content
            Generation feature).
            <br />
          </Text>
          <Field.Root>
            <Field.Label>Project Name</Field.Label>
            <Input {...form.register("name", { required: true })} />
          </Field.Root>
          {teams.data?.some((team) => team.projects.length > 0) && (
            <>
              <Field.Root>
                <Field.Label>Team</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field {...form.register("teamId", { required: true })}>
                    {teams.data?.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                    <option value="NEW">(+) Create new team</option>
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Field.Root>
              {teamId == "NEW" && (
                <Field.Root>
                  <Field.Label>New Team Name</Field.Label>
                  <Input {...form.register("newTeamName", { required: true })} />
                </Field.Root>
              )}
            </>
          )}
          <TechStackSelector form={form} />
          {createProject.error && <p>Something went wrong!</p>}
          <HStack width="full">
            <Button
              colorPalette="orange"
              type="submit"
              disabled={createProject.isPending || createProject.isSuccess}
            >
              {createProject.isSuccess
                ? "Created"
                : createProject.isPending
                  ? "Loading..."
                  : "Next"}
            </Button>
          </HStack>
        </VStack>
      </form>
    </SetupLayout>
  );
}
