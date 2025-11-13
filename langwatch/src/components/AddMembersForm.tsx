import {
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Mail, Plus, Trash } from "react-feather";
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type SubmitHandler,
} from "react-hook-form";
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";

type Option = { label: string; value: string; description?: string };

type TeamAssignment = {
  teamId: string;
  role: TeamUserRole;
};

type InviteData = {
  email: string;
  orgRole: OrganizationUserRole;
  teams: TeamAssignment[];
};

export type MembersForm = {
  invites: InviteData[];
};

interface AddMembersFormProps {
  teamOptions: Option[];
  orgRoleOptions: Option[];
  onSubmit: SubmitHandler<MembersForm>;
  isLoading?: boolean;
  hasEmailProvider?: boolean;
  onClose?: () => void;
  onCloseText?: string;
}

/**
 * Reusable form component for adding members to an organization
 * Single Responsibility: Handles the form logic and UI for inviting new members
 */
export function AddMembersForm({
  teamOptions,
  orgRoleOptions,
  onSubmit,
  isLoading = false,
  hasEmailProvider = false,
  onClose,
  onCloseText = "Cancel",
}: AddMembersFormProps) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<MembersForm>({
    defaultValues: {
      invites: [
        {
          email: "",
          orgRole: OrganizationUserRole.MEMBER,
          teams: [],
        },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "invites",
  });

  const onAddField = () => {
    append({
      email: "",
      orgRole: OrganizationUserRole.MEMBER,
      teams: [],
    });
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void handleSubmit(onSubmit)(e);
  };

  return (
    <form onSubmit={handleFormSubmit}>
      <VStack align="start" gap={4} width="100%">
        <Table.Root variant="line" width="100%">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader paddingLeft={0} paddingTop={0}>
                Email
              </Table.ColumnHeader>
              <Table.ColumnHeader paddingLeft={0} paddingTop={0}>
                Org Role
              </Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {fields.map((field, index) => (
              <MemberRow
                key={field.id}
                index={index}
                control={control}
                register={register}
                errors={errors}
                teamOptions={teamOptions}
                orgRoleOptions={orgRoleOptions}
                onRemove={() => remove(index)}
              />
            ))}
          </Table.Body>
        </Table.Root>
        <Button type="button" onClick={onAddField} marginTop={2}>
          <Plus size={16} /> Add another
        </Button>

        <HStack justify="end" width="100%" marginTop={4}>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
          >
            {onCloseText}
          </Button>
          <Button
            colorPalette={isLoading ? "gray" : "orange"}
            type="submit"
            disabled={isLoading}
          >
            <HStack>
              {isLoading ? <Spinner size="sm" /> : <Mail size={18} />}
              <Text>
                {hasEmailProvider ? "Send invites" : "Create invites"}
              </Text>
            </HStack>
          </Button>
        </HStack>
      </VStack>
    </form>
  );
}

/**
 * MemberRow component - renders a single member row with nested teams table
 */
function MemberRow({
  index,
  control,
  register,
  errors,
  teamOptions,
  orgRoleOptions,
  onRemove,
}: {
  index: number;
  control: any;
  register: any;
  errors: any;
  teamOptions: Option[];
  orgRoleOptions: Option[];
  onRemove: () => void;
}) {
  const {
    fields: teamFields,
    append: appendTeam,
    remove: removeTeam,
  } = useFieldArray({
    control,
    name: `invites.${index}.teams`,
  });

  // Watch the teams array for this specific member to track selected teams
  const selectedTeams = useWatch({
    control,
    name: `invites.${index}.teams`,
  });

  /**
   * Get available team options by filtering out already selected teams
   * @param currentTeamIndex - The index of the team currently being edited (to exclude it from filtering)
   * @returns Filtered array of team options
   */
  const getAvailableTeamOptions = (currentTeamIndex?: number) => {
    const selectedTeamIds = selectedTeams
      ?.map((team: TeamAssignment | undefined, idx: number) => {
        // Include the current team being edited so it doesn't filter itself out
        if (currentTeamIndex !== undefined && idx === currentTeamIndex) {
          return null;
        }
        return team?.teamId;
      })
      .filter(
        (id: string | null | undefined): id is string =>
          id !== null && id !== "" && id !== undefined,
      );

    return teamOptions.filter(
      (option) => !selectedTeamIds?.includes(option.value),
    );
  };

  const handleAddTeam = () => {
    const availableTeams = getAvailableTeamOptions();
    if (availableTeams.length > 0) {
      appendTeam({
        teamId: availableTeams[0]?.value ?? "",
        role: TeamUserRole.MEMBER,
      });
    }
  };

  return (
    <>
      <Table.Row>
        <Table.Cell paddingLeft={0} paddingY={2} verticalAlign="top">
          <Field.Root>
            <Input
              placeholder="Enter email address"
              {...register(`invites.${index}.email`, {
                required: "Email is required",
              })}
            />
            <Field.ErrorText>
              {errors.invites?.[index]?.email?.message}
            </Field.ErrorText>
          </Field.Root>
        </Table.Cell>
        <Table.Cell paddingLeft={0} paddingY={2} verticalAlign="top">
          <Field.Root>
            <Controller
              control={control}
              name={`invites.${index}.orgRole`}
              render={({ field }) => (
                <NativeSelect.Root>
                  <NativeSelect.Field {...field}>
                    {orgRoleOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </NativeSelect.Field>
                </NativeSelect.Root>
              )}
            />
          </Field.Root>
        </Table.Cell>
      </Table.Row>
      {teamFields.length > 0 && (
        <Table.Row>
          <Table.Cell colSpan={2} paddingLeft={0} paddingY={2}>
            <VStack align="start" gap={2} width="100%">
              <Table.Root variant="line" size="sm" width="100%">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader paddingLeft={0} paddingTop={0}>
                      Team
                    </Table.ColumnHeader>
                    <Table.ColumnHeader paddingLeft={0} paddingTop={0}>
                      Role
                    </Table.ColumnHeader>
                    <Table.ColumnHeader
                      paddingLeft={0}
                      paddingRight={0}
                      paddingTop={0}
                    >
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={handleAddTeam}
                        disabled={getAvailableTeamOptions().length === 0}
                      >
                        <Plus size={14} /> Add team
                      </Button>
                    </Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {teamFields.map((teamField, teamIndex) => (
                    <Table.Row key={teamField.id}>
                      <Table.Cell paddingLeft={0} paddingY={2}>
                        <Controller
                          control={control}
                          name={`invites.${index}.teams.${teamIndex}.teamId`}
                          rules={{ required: "Team is required" }}
                          render={({ field }) => {
                            const availableOptions =
                              getAvailableTeamOptions(teamIndex);
                            return (
                              <NativeSelect.Root>
                                <NativeSelect.Field {...field}>
                                  {availableOptions.length === 0 ? (
                                    <option value="">No teams available</option>
                                  ) : (
                                    availableOptions.map((option) => (
                                      <option
                                        key={option.value}
                                        value={option.value}
                                      >
                                        {option.label}
                                      </option>
                                    ))
                                  )}
                                </NativeSelect.Field>
                              </NativeSelect.Root>
                            );
                          }}
                        />
                      </Table.Cell>
                      <Table.Cell paddingLeft={0} paddingY={2}>
                        <Controller
                          control={control}
                          name={`invites.${index}.teams.${teamIndex}.role`}
                          render={({ field }) => (
                            <NativeSelect.Root>
                              <NativeSelect.Field {...field}>
                                <option value={TeamUserRole.ADMIN}>
                                  Admin
                                </option>
                                <option value={TeamUserRole.MEMBER}>
                                  Member
                                </option>
                                <option value={TeamUserRole.VIEWER}>
                                  Viewer
                                </option>
                              </NativeSelect.Field>
                            </NativeSelect.Root>
                          )}
                        />
                      </Table.Cell>
                      <Table.Cell paddingLeft={0} paddingRight={0} paddingY={2}>
                        <Button
                          type="button"
                          size="sm"
                          colorPalette="red"
                          variant="ghost"
                          onClick={() => removeTeam(teamIndex)}
                        >
                          <Text fontSize="sm">remove</Text>
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </VStack>
          </Table.Cell>
        </Table.Row>
      )}
      {teamFields.length === 0 && (
        <Table.Row>
          <Table.Cell colSpan={2} paddingLeft={0} paddingY={2}>
            <HStack gap={2}>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleAddTeam}
                disabled={getAvailableTeamOptions().length === 0}
              >
                <Plus size={14} /> Add team
              </Button>
              <Button
                type="button"
                size="sm"
                colorPalette="red"
                variant="ghost"
                onClick={onRemove}
              >
                <Trash size={14} />
              </Button>
            </HStack>
          </Table.Cell>
        </Table.Row>
      )}
    </>
  );
}
