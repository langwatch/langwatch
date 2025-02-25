import {
  Alert,
  Box,
  Button,
  Field,
  Heading,
  HStack,
  Input,
  NativeSelect,
  RadioGroup,
  Text,
  VStack,
} from "@chakra-ui/react";
import ErrorPage from "next/error";
import { useRouter } from "next/router";
import { forwardRef, useEffect } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { SetupLayout } from "~/components/SetupLayout";
import {
  TechStackSelector,
  type ProjectFormData,
} from "~/components/TechStack";
import { Link } from "~/components/ui/link";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../../../hooks/useRequiredSession";
import { api } from "../../../utils/api";
import { trackEvent } from "../../../utils/tracking";

type RadioCardProps = {
  value: string;
  children: React.ReactNode;
};

export const RadioCard = forwardRef<HTMLInputElement, RadioCardProps>(
  function RadioCard(props, ref) {
    const { children, value } = props;

    return (
      <RadioGroup.Item value={value}>
        <RadioGroup.ItemHiddenInput ref={ref} />
        <Box
          cursor="pointer"
          borderRadius="md"
          _hover={{
            backgroundColor: "gray.50",
          }}
          _checked={{
            backgroundColor: "gray.50",
          }}
          px={5}
          py={3}
          height="full"
          display="flex"
          alignItems="center"
        >
          {children}
        </Box>
      </RadioGroup.Item>
    );
  }
);

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
  const { organization, project } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });

  const { team: teamSlug } = router.query;
  const team = api.team.getBySlug.useQuery(
    {
      slug: typeof teamSlug == "string" ? teamSlug : "",
      organizationId: organization?.id ?? "",
    },
    { enabled: !!organization }
  );
  const teams = api.team.getTeamsWithMembers.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization }
  );
  const usage = api.limits.getUsage.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    }
  );
  const returnTo =
    typeof router.query.return_to === "string"
      ? router.query.return_to
      : undefined;

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
          if (
            returnTo &&
            (returnTo.startsWith("/") ||
              returnTo.startsWith(window.location.origin))
          ) {
            window.location.href = returnTo;
          } else {
            window.location.href = `/${data.projectSlug}/messages`;
          }
        },
      }
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
          {usage.data &&
            usage.data.projectsCount >= usage.data.activePlan.maxProjects &&
            !usage.data.activePlan.overrideAddingLimitations && (
              <Alert.Root>
                <Alert.Indicator />
                <Alert.Content>
                  <Text>
                    You have reached the maximum number of projects allowed by
                    your plan. Please{" "}
                    <Link
                      href={`/settings/subscription`}
                      textDecoration="underline"
                      _hover={{
                        textDecoration: "none",
                      }}
                      onClick={() => {
                        trackEvent("subscription_hook_click", {
                          project_id: project?.id,
                          hook: "new_project_limit_reached",
                        });
                      }}
                    >
                      upgrade your plan
                    </Link>{" "}
                    to create more projects.
                  </Text>
                </Alert.Content>
              </Alert.Root>
            )}
          <Text paddingBottom={4} fontSize="14px">
            You can set up separate projects for each service or LLM feature of
            your application (for example, one for your ChatBot, another for
            that Content Generation feature).
            <br />
          </Text>
          <Field.Root>
            <Field.Label>Project Name</Field.Label>
            <Input {...form.register("name", { required: true })} />
          </Field.Root>
          {teams.data &&
            teams.data.some((team) => team.projects.length > 0) && (
              <>
                <Field.Root>
                  <Field.Label>Team</Field.Label>
                  <NativeSelect.Root>
                    <NativeSelect.Field
                      {...form.register("teamId", { required: true })}
                    >
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
                    <Input
                      {...form.register("newTeamName", { required: true })}
                    />
                  </Field.Root>
                )}
              </>
            )}
          <TechStackSelector form={form} />
          {createProject.error && <p>Something went wrong!</p>}
          <HStack width="full">
            <Tooltip
              content={
                usage.data &&
                usage.data.projectsCount >= usage.data.activePlan.maxProjects
                  ? "You reached the limit of max new projects, upgrade your plan to add more projects"
                  : ""
              }
              positioning={{ placement: "top" }}
            >
              <Button
                colorPalette="orange"
                type="submit"
                disabled={
                  createProject.isLoading ||
                  (usage.data &&
                    usage.data.projectsCount >=
                      usage.data.activePlan.maxProjects &&
                    !usage.data.activePlan.overrideAddingLimitations)
                }
              >
                {createProject.isLoading || createProject.isSuccess
                  ? "Loading..."
                  : "Next"}
              </Button>
            </Tooltip>
          </HStack>
        </VStack>
      </form>
    </SetupLayout>
  );
}
