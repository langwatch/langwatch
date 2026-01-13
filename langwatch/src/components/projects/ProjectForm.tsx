import React, { useEffect } from "react";
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
import { type SubmitHandler, useForm } from "react-hook-form";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { isAtMaxProjects } from "../../utils/limits";
import { trackEvent } from "../../utils/tracking";
import { Link } from "../ui/link";

export interface ProjectFormData {
  name: string;
  teamId: string;
  newTeamName?: string;
}

export interface ProjectFormProps {
  onSubmit: (data: ProjectFormData & { language: string; framework: string }) => void;
  isLoading?: boolean;
  error?: string | null;
  defaultTeamId?: string;
}

export function ProjectForm(props: ProjectFormProps): React.ReactElement {
  const { onSubmit: onSubmitProp, isLoading = false, error, defaultTeamId } = props;
  const { organization, project } = useOrganizationTeamProject();

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
      // Use defaultTeamId if provided and valid, otherwise use first team
      const teamIdToUse =
        defaultTeamId && teams.data.some((t: { id: string }) => t.id === defaultTeamId)
          ? defaultTeamId
          : teams.data[0]?.id ?? "";

      reset((prev) => ({
        ...prev,
        teamId: teamIdToUse,
      }));
    }
  }, [teams.data, teamId, reset, defaultTeamId]);

  const onSubmit: SubmitHandler<ProjectFormData> = (data) => {
    onSubmitProp({ ...data, language: "other", framework: "other" });
  };

  const atMaxProjects = isAtMaxProjects(usage.data);

  const showTeamSelector =
    teams.data?.some((team: { projects: unknown[] }) => team.projects.length > 0) ?? false;

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={handleSubmit(onSubmit)}>
      <VStack align="stretch" gap={6}>
        {atMaxProjects && (
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
            {...register("name", {
              required: "Project name is required",
              validate: (v) => v.trim().length > 0 || "Project name is required",
            })}
            placeholder="AI Project"
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

        {error && (
          <Text color="red.500">{error}</Text>
        )}

        <HStack width="full">
          <Spacer />
          <Button
            colorPalette="orange"
            type="submit"
            loading={isLoading}
            disabled={atMaxProjects || isLoading}
          >
            Create
          </Button>
        </HStack>
      </VStack>
    </form>
  );
}
