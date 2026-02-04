import {
  Box,
  Button,
  createListCollection,
  Field,
  HStack,
  Input,
  type ListCollection,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { Controller, type Control, type SubmitHandler, useForm } from "react-hook-form";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { Select } from "../ui/select";
import {
  NEW_TEAM_VALUE,
  validateNewTeamName,
  validateProjectName,
} from "./projectFormValidation";

export interface ProjectFormData {
  name: string;
  teamId: string;
  newTeamName?: string;
}

export interface ProjectFormProps {
  onSubmit: (
    data: ProjectFormData & { language: string; framework: string },
  ) => void;
  isLoading?: boolean;
  error?: string | null;
  defaultTeamId?: string;
  /** Required for creating projects in a different organization via the dropdown menu.
   * Ensures teams are fetched from the target organization, not the current context. */
  organizationId?: string;
}

export function ProjectForm(props: ProjectFormProps): React.ReactElement {
  const {
    onSubmit: onSubmitProp,
    isLoading = false,
    error,
    defaultTeamId,
    organizationId: organizationIdProp,
  } = props;
  const { organization: currentOrganization } = useOrganizationTeamProject();

  // Use the explicitly passed organizationId if provided, otherwise fall back to the current organization
  const effectiveOrganizationId =
    organizationIdProp ?? currentOrganization?.id;

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    control,
  } = useForm<ProjectFormData>({
    defaultValues: {
      name: "",
      teamId: "",
    },
  });

  const teamId = watch("teamId");

  const teams = api.team.getTeamsWithMembers.useQuery(
    { organizationId: effectiveOrganizationId ?? "" },
    { enabled: !!effectiveOrganizationId },
  );

  // Set default team when teams are loaded
  useEffect(() => {
    if (teams.data && teams.data.length > 0 && !teamId) {
      // Use defaultTeamId if provided and valid, otherwise use first team
      const teamIdToUse =
        defaultTeamId &&
        teams.data.some((t: { id: string }) => t.id === defaultTeamId)
          ? defaultTeamId
          : (teams.data[0]?.id ?? "");

      reset((prev) => ({
        ...prev,
        teamId: teamIdToUse,
      }));
    }
  }, [teams.data, teamId, reset, defaultTeamId]);

  const onSubmit: SubmitHandler<ProjectFormData> = (data) => {
    onSubmitProp({ ...data, language: "other", framework: "other" });
  };

  const showTeamSelector =
    teams.data?.some(
      (team: { projects: unknown[] }) => team.projects.length > 0,
    ) ?? false;

  const teamOptions = useMemo(() => {
    return (
      teams.data?.map((team: { id: string; name: string }) => ({
        label: team.name,
        value: team.id,
      })) ?? []
    );
  }, [teams.data]);

  const teamCollection = useMemo(
    () => createListCollection({ items: teamOptions }),
    [teamOptions],
  );

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={handleSubmit(onSubmit)}>
      <VStack align="stretch" gap={6}>
        <Text fontSize="sm" color="fg.muted">
          You can set up separate projects for each service or LLM feature of
          your application (for example, one for your ChatBot, another for that
          Content Generation feature).
        </Text>

        <Field.Root invalid={!!errors.name}>
          <Field.Label>Project Name</Field.Label>
          <Input
            {...register("name", {
              required: "Project name is required",
              validate: validateProjectName,
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
              <TeamSelectWithCreateButton
                control={control}
                teamCollection={teamCollection}
                teamOptions={teamOptions}
              />
            </Field.Root>

            {teamId === NEW_TEAM_VALUE && (
              <Field.Root invalid={!!errors.newTeamName}>
                <Field.Label>New Team Name</Field.Label>
                <Input
                  {...register("newTeamName", {
                    validate: (value) => validateNewTeamName(teamId, value),
                  })}
                  placeholder="Engineering Team"
                />
                {errors.newTeamName && (
                  <Field.ErrorText>
                    {errors.newTeamName.message}
                  </Field.ErrorText>
                )}
              </Field.Root>
            )}
          </>
        )}

        {error && <Text color="red.fg">{error}</Text>}

        <HStack width="full">
          <Spacer />
          <Button
            colorPalette="orange"
            type="submit"
            loading={isLoading}
            disabled={isLoading}
          >
            Create
          </Button>
        </HStack>
      </VStack>
    </form>
  );
}

function TeamSelectWithCreateButton({
  control,
  teamCollection,
  teamOptions,
}: {
  control: Control<ProjectFormData>;
  teamCollection: ListCollection<{ label: string; value: string }>;
  teamOptions: Array<{ label: string; value: string }>;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Controller
      control={control}
      name="teamId"
      rules={{ required: "Team is required" }}
      render={({ field }) => (
        <Select.Root
          collection={teamCollection}
          value={[field.value]}
          open={isOpen}
          onOpenChange={(details) => setIsOpen(details.open)}
          onValueChange={(details) => {
            const selectedValue = details.value[0];
            if (selectedValue) {
              field.onChange(selectedValue);
            }
          }}
        >
          <Select.Trigger>
            <Select.ValueText placeholder="Select team">
              {() =>
                field.value === NEW_TEAM_VALUE ? (
                  <Text color="fg.muted">New team</Text>
                ) : (
                  teamOptions.find((o) => o.value === field.value)?.label ??
                  "Select team"
                )
              }
            </Select.ValueText>
          </Select.Trigger>
          <Select.Content paddingY={2} zIndex="popover">
            {teamOptions.map((option) => (
              <Select.Item key={option.value} item={option}>
                {option.label}
              </Select.Item>
            ))}
            <Box
              borderTop="1px solid"
              borderColor="border"
              marginTop={2}
              marginX={-1}
              marginBottom={-2}
              background="bg.muted"
            >
              <Button
                width="full"
                fontWeight="500"
                color="fg.muted"
                paddingY={4}
                paddingX={3}
                justifyContent="flex-start"
                variant="ghost"
                colorPalette="gray"
                size="sm"
                borderRadius="none"
                onClick={() => {
                  field.onChange(NEW_TEAM_VALUE);
                  setIsOpen(false);
                }}
              >
                <Plus size={16} />
                <Text fontSize={14}>Create new team</Text>
              </Button>
            </Box>
          </Select.Content>
        </Select.Root>
      )}
    />
  );
}
