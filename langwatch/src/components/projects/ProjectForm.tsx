import {
  Alert,
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { trackEvent } from "../../utils/tracking";
import { Link } from "../ui/link";
import { FrameworkGrid } from "./FrameworkGrid";
import { LanguageGrid } from "./LanguageGrid";
import {
  getDefaultFramework,
  isFrameworkAvailableForLanguage,
  type FrameworkKey,
  type LanguageKey,
} from "./techStackOptions";

export interface ProjectFormData {
  name: string;
  teamId: string;
  newTeamName?: string;
}

export interface ProjectFormProps {
  onSubmit: (data: ProjectFormData & { language: LanguageKey; framework: FrameworkKey }) => void;
  isLoading?: boolean;
  error?: string | null;
}

export function ProjectForm(props: ProjectFormProps): React.ReactElement {
  const { onSubmit: onSubmitProp, isLoading = false, error } = props;
  const { organization, project } = useOrganizationTeamProject();

  const [language, setLanguage] = useState<LanguageKey>("python");
  const [framework, setFramework] = useState<FrameworkKey>("openai");

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<ProjectFormData>({
    defaultValues: {
      name: "",
      teamId: "",
    },
  });

  const teamId = watch("teamId");

  const teams = api.team.getTeamsWithMembers.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization },
  );

  const usage = api.limits.getUsage.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );

  // Set default team when teams are loaded
  useEffect(() => {
    if (teams.data && teams.data.length > 0 && !teamId) {
      reset((prev) => ({
        ...prev,
        teamId: teams.data[0]?.id ?? "",
      }));
    }
  }, [teams.data, teamId, reset]);

  // Update framework when language changes (if current is incompatible)
  useEffect(() => {
    if (!isFrameworkAvailableForLanguage(framework, language)) {
      setFramework(getDefaultFramework(language));
    }
  }, [language, framework]);

  const onSubmit: SubmitHandler<ProjectFormData> = (data) => {
    onSubmitProp({ ...data, language, framework });
  };

  const isAtMaxProjects =
    usage.data &&
    usage.data.projectsCount >= usage.data.activePlan.maxProjects &&
    !usage.data.activePlan.overrideAddingLimitations;

  const showTeamSelector =
    teams.data?.some((team: { projects: unknown[] }) => team.projects.length > 0) ?? false;

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={handleSubmit(onSubmit)}>
      <VStack align="stretch" gap={6}>
        {isAtMaxProjects && (
          <Alert.Root>
            <Alert.Indicator />
            <Alert.Content>
              <Text>
                You have reached the maximum number of projects allowed by
                your plan. Please{" "}
                <Link
                  href="/settings/subscription"
                  textDecoration="underline"
                  _hover={{ textDecoration: "none" }}
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

        <Text fontSize="sm" color="fg.muted">
          You can set up separate projects for each service or LLM feature
          of your application (for example, one for your ChatBot, another
          for that Content Generation feature).
        </Text>

        <Field.Root invalid={!!errors.name}>
          <Field.Label>Project Name</Field.Label>
          <Input
            {...register("name", { required: "Project name is required" })}
            placeholder="My AI Chatbot"
          />
          {errors.name && (
            <Field.ErrorText>{errors.name.message}</Field.ErrorText>
          )}
        </Field.Root>

        {showTeamSelector && (
          <>
            <Field.Root invalid={!!errors.teamId}>
              <Field.Label>Team</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field
                  {...register("teamId", { required: "Team is required" })}
                >
                  {teams.data?.map((team: { id: string; name: string }) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                  <option value="NEW">(+) Create new team</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>

            {teamId === "NEW" && (
              <Field.Root invalid={!!errors.newTeamName}>
                <Field.Label>New Team Name</Field.Label>
                <Input
                  {...register("newTeamName", {
                    required: teamId === "NEW" ? "Team name is required" : false,
                  })}
                  placeholder="Engineering Team"
                />
                {errors.newTeamName && (
                  <Field.ErrorText>{errors.newTeamName.message}</Field.ErrorText>
                )}
              </Field.Root>
            )}
          </>
        )}

        <LanguageGrid
          selectedLanguage={language}
          onSelectLanguage={setLanguage}
        />

        <FrameworkGrid
          selectedLanguage={language}
          selectedFramework={framework}
          onSelectFramework={setFramework}
        />

        {error && (
          <Text color="red.500">{error}</Text>
        )}

        <HStack width="full">
          <Spacer />
          <Button
            colorPalette="orange"
            type="submit"
            loading={isLoading}
            disabled={isAtMaxProjects || isLoading}
          >
            Create
          </Button>
        </HStack>
      </VStack>
    </form>
  );
}
