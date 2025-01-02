import {
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  Heading,
  Input,
  Text,
  VStack,
  useRadio,
  type UseRadioProps,
  Select,
  Alert,
  AlertIcon,
  Tooltip,
  Link,
} from "@chakra-ui/react";
import ErrorPage from "next/error";
import { useRouter } from "next/router";
import { useEffect, type PropsWithChildren } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { SetupLayout } from "~/components/SetupLayout";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { useRequiredSession } from "../../../hooks/useRequiredSession";
import {
  TechStackSelector,
  type ProjectFormData,
} from "~/components/TechStack";
import { api } from "../../../utils/api";
import { trackEvent } from "../../../utils/tracking";

export function RadioCard(props: UseRadioProps & PropsWithChildren) {
  const { getInputProps, getRadioProps } = useRadio(props);

  const input = getInputProps();
  const checkbox = getRadioProps();

  return (
    <Box height="auto" as="label">
      <input {...input} />
      <Box
        {...checkbox}
        cursor="pointer"
        // borderWidth="1px"
        borderRadius="md"
        // boxShadow="md"
        _hover={{
          backgroundColor: "gray.50",
        }}
        _checked={{
          // borderColor: "orange.600",
          backgroundColor: "gray.50",
          // borderWidth: "2px"
        }}
        px={5}
        py={3}
        height="full"
        display="flex"
        alignItems="center"
      >
        {props.children}
      </Box>
    </Box>
  );
}

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
  const apiContext = api.useContext();

  const onSubmit: SubmitHandler<ProjectFormData> = (data: ProjectFormData) => {
    if (!team.data) return;

    createProject.mutate({
      organizationId: organization?.id ?? "",
      name: data.name,
      teamId: data.teamId == "NEW" ? undefined : data.teamId,
      newTeamName: data.newTeamName,
      language: data.language,
      framework: data.framework,
    });
  };

  useEffect(() => {
    if (createProject.isSuccess) {
      void (async () => {
        await apiContext.organization.getAll.refetch();
        // For some reason even though we await for the refetch it's not done yet when we move pages
        setTimeout(() => {
          if (returnTo) {
            void router.push(returnTo);
          } else {
            void router.push(`/${createProject.data.projectSlug}/messages`);
          }
        }, 1000);
      })();
    }
  }, [
    apiContext.organization,
    apiContext.organization.getAll,
    createProject.data?.projectSlug,
    createProject.isSuccess,
    returnTo,
    router,
  ]);

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
              <Alert status="warning">
                <AlertIcon />
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
              </Alert>
            )}
          <Text paddingBottom={4} fontSize="14px">
            You can set up separate projects for each service or LLM feature of
            your application (for example, one for your ChatBot, another for
            that Content Generation feature).
            <br />
          </Text>
          <FormControl>
            <FormLabel>Project Name</FormLabel>
            <Input {...form.register("name", { required: true })} />
          </FormControl>
          {teams.data &&
            teams.data.some((team) => team.projects.length > 0) && (
              <>
                <FormControl>
                  <FormLabel>Team</FormLabel>
                  <Select {...form.register("teamId", { required: true })}>
                    {teams.data?.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                    <option value="NEW">(+) Create new team</option>
                  </Select>
                </FormControl>
                {teamId == "NEW" && (
                  <FormControl>
                    <FormLabel>New Team Name</FormLabel>
                    <Input
                      {...form.register("newTeamName", { required: true })}
                    />
                  </FormControl>
                )}
              </>
            )}
          <TechStackSelector form={form} />
          {createProject.error && <p>Something went wrong!</p>}
          <HStack width="full">
            <Tooltip
              label={
                usage.data &&
                usage.data.projectsCount >= usage.data.activePlan.maxProjects
                  ? "You reached the limit of max new projects, upgrade your plan to add more projects"
                  : ""
              }
            >
              <Button
                colorScheme="orange"
                type="submit"
                isDisabled={
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
