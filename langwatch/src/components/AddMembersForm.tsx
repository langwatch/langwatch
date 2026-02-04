import {
  Box,
  Button,
  createListCollection,
  Field,
  HStack,
  Input,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { Mail, Plus, Trash2 } from "lucide-react";
import {
  Controller,
  type Control,
  type FieldErrors,
  type SubmitHandler,
  type UseFormRegister,
  type UseFormSetValue,
  useFieldArray,
  useForm,
  useWatch,
} from "react-hook-form";
import { useEffect, useMemo, useRef } from "react";
import { api } from "~/utils/api";
import {
  teamRolesOptions,
  TeamRoleSelectItemContent,
  type RoleOption,
} from "./settings/TeamUserRoleField";
import { Select } from "./ui/select";

type Option = { label: string; value: string; description?: string };

type TeamAssignment = {
  teamId: string;
  role: TeamUserRole | string; // Can be TeamUserRole or "custom:{roleId}"
  customRoleId?: string; // Required when role starts with "custom:"
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
  organizationId: string;
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
  organizationId,
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
    setValue,
    formState: { errors },
  } = useForm<MembersForm>({
    defaultValues: {
      invites: [
        {
          email: "",
          orgRole: OrganizationUserRole.MEMBER,
          teams:
            teamOptions.length > 0
              ? [
                  {
                    teamId: teamOptions[0]?.value ?? "",
                    role: TeamUserRole.MEMBER,
                  },
                ]
              : [],
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
      teams:
        teamOptions.length > 0
          ? [
              {
                teamId: teamOptions[0]?.value ?? "",
                role: TeamUserRole.MEMBER,
              },
            ]
          : [],
    });
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void handleSubmit(onSubmit)(e);
  };

  return (
    <form onSubmit={handleFormSubmit}>
      <VStack align="start" gap={4} width="100%">
        {fields.map((field, index) => (
          <MemberRow
            key={field.id}
            index={index}
            control={control}
            register={register}
            errors={errors}
            teamOptions={teamOptions}
            orgRoleOptions={orgRoleOptions}
            organizationId={organizationId}
            setValue={setValue}
            onRemove={() => remove(index)}
          />
        ))}
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
  organizationId,
  setValue,
  onRemove,
}: {
  index: number;
  control: Control<MembersForm>;
  register: UseFormRegister<MembersForm>;
  errors: FieldErrors<MembersForm>;
  teamOptions: Option[];
  orgRoleOptions: Option[];
  organizationId: string;
  setValue: UseFormSetValue<MembersForm>;
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

  // Watch the org role for this member to filter team role options
  const orgRole = useWatch({
    control,
    name: `invites.${index}.orgRole`,
  }) as OrganizationUserRole;

  // Track previous org role to detect changes
  const prevOrgRoleRef = useRef<OrganizationUserRole>(orgRole);

  // Auto-correct team roles when org role changes
  useEffect(() => {
    if (prevOrgRoleRef.current !== orgRole && selectedTeams?.length > 0) {
      selectedTeams.forEach(
        (team: TeamAssignment | undefined, teamIndex: number) => {
          if (!team) return;

          const currentRole = team.role;

          if (orgRole === OrganizationUserRole.EXTERNAL) {
            // Viewer: force all team roles to Viewer
            if (currentRole !== TeamUserRole.VIEWER) {
              setValue(`invites.${index}.teams.${teamIndex}.role`, TeamUserRole.VIEWER);
              setValue(`invites.${index}.teams.${teamIndex}.customRoleId`, undefined);
            }
          } else if (orgRole === OrganizationUserRole.MEMBER) {
            // Member: if current role is Viewer, switch to Member
            if (currentRole === TeamUserRole.VIEWER) {
              setValue(`invites.${index}.teams.${teamIndex}.role`, TeamUserRole.MEMBER);
            }
          }
          // Admin: no changes needed, all roles are valid
        },
      );
    }
    prevOrgRoleRef.current = orgRole;
  }, [orgRole, selectedTeams, index, setValue]);

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
        role: getDefaultTeamRole(orgRole),
      });
    }
  };

  const orgRoleCollection = useMemo(
    () => createListCollection({ items: orgRoleOptions }),
    [orgRoleOptions],
  );

  return (
    <VStack align="stretch" gap={4} width="full">
      <HStack gap={4} align="start">
        <Field.Root flex="1" invalid={!!errors.invites?.[index]?.email}>
          <Field.Label>Email</Field.Label>
          <Input
            placeholder="Enter email address"
            {...register(`invites.${index}.email`, {
              required: "Email is required",
              pattern: {
                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                message: "Invalid email address",
              },
            })}
          />
          <Field.ErrorText>
            {errors.invites?.[index]?.email?.message}
          </Field.ErrorText>
        </Field.Root>
        <Field.Root flex="1">
          <Field.Label>Org Role</Field.Label>
          <Controller
            control={control}
            name={`invites.${index}.orgRole`}
            render={({ field }) => (
              <Select.Root
                collection={orgRoleCollection}
                value={[field.value]}
                onValueChange={(details) => {
                  const selectedValue = details.value[0];
                  if (selectedValue) {
                    field.onChange(selectedValue);
                  }
                }}
              >
                <Select.Trigger>
                  <Select.ValueText placeholder="Select role" />
                </Select.Trigger>
                <Select.Content paddingY={2} zIndex="popover" width="320px">
                  {orgRoleOptions.map((option) => (
                    <Select.Item key={option.value} item={option}>
                      <VStack align="start" gap={0} flex={1}>
                        <Text>{option.label}</Text>
                        <Text color="fg.muted" fontSize="13px">
                          {option.description}
                        </Text>
                      </VStack>
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            )}
          />
        </Field.Root>
        <Box alignSelf="start" paddingTop={7}>
          <Button
            type="button"
            size="sm"
            colorPalette="red"
            variant="ghost"
            onClick={onRemove}
          >
            <Trash2 size={16} />
          </Button>
        </Box>
      </HStack>
      {teamFields.length > 0 && (
        <VStack
          align="start"
          gap={2}
          width="100%"
        >
          <HStack justify="space-between" width="100%">
            <Text fontSize="sm" fontWeight="medium" color="fg">
              Team Assignments
            </Text>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-variant="ghost"
              onClick={handleAddTeam}
              disabled={getAvailableTeamOptions().length === 0}
            >
              <Plus size={14} /> Add team
            </Button>
          </HStack>
          <Box
            paddingX={4}
            paddingY={3}
            backgroundColor="bg.muted"
            borderRadius="xl"
            width="100%"
          >
            <Table.Root variant={"ghost" as any} width="100%">
              <Table.Header>
                <Table.Row backgroundColor="transparent">
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
                    width="50px"
                  ></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {teamFields.map((teamField, teamIndex) => (
                  <Table.Row key={teamField.id} backgroundColor="transparent">
                    <Table.Cell paddingLeft={0}>
                      <TeamSelect
                        index={index}
                        teamIndex={teamIndex}
                        control={control}
                        getAvailableTeamOptions={getAvailableTeamOptions}
                      />
                    </Table.Cell>
                    <Table.Cell paddingLeft={0}>
                      <TeamRoleSelect
                        index={index}
                        teamIndex={teamIndex}
                        control={control}
                        organizationId={organizationId}
                        orgRole={orgRole}
                        setValue={setValue}
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
                        <Trash2 size={16} />
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Box>
        </VStack>
      )}
      {teamFields.length === 0 && (
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
        </HStack>
      )}
    </VStack>
  );
}

/**
 * TeamSelect component - renders a dropdown for selecting a team
 */
function TeamSelect({
  index,
  teamIndex,
  control,
  getAvailableTeamOptions,
}: {
  index: number;
  teamIndex: number;
  control: Control<MembersForm>;
  getAvailableTeamOptions: (currentTeamIndex?: number) => Option[];
}) {
  const availableOptions = getAvailableTeamOptions(teamIndex);

  const teamCollection = useMemo(
    () => createListCollection({ items: availableOptions }),
    [availableOptions],
  );

  return (
    <Controller
      control={control}
      name={`invites.${index}.teams.${teamIndex}.teamId`}
      rules={{ required: "Team is required" }}
      render={({ field }) => (
        <Select.Root
          collection={teamCollection}
          value={[field.value]}
          onValueChange={(details) => {
            const selectedValue = details.value[0];
            if (selectedValue) {
              field.onChange(selectedValue);
            }
          }}
        >
          <Select.Trigger background="bg" width="full">
            <Select.ValueText placeholder="Select team" />
          </Select.Trigger>
          <Select.Content paddingY={2} zIndex="popover">
            {availableOptions.map((option) => (
              <Select.Item key={option.value} item={option}>
                {option.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      )}
    />
  );
}

/**
 * Get the appropriate team role options based on org role
 * - EXTERNAL (Viewer): only Viewer
 * - MEMBER: all except Viewer (+ custom roles)
 * - ADMIN: all roles (+ custom roles)
 */
function getFilteredTeamRoles(
  orgRole: OrganizationUserRole,
  customRoles: Array<{ id: string; name: string; description?: string | null }>,
): RoleOption[] {
  const baseRoles = Object.values(teamRolesOptions);

  const customRoleOptions: RoleOption[] = customRoles.map((role) => ({
    label: role.name,
    value: `custom:${role.id}`,
    description: role.description ?? `Custom role`,
    isCustom: true,
    customRoleId: role.id,
  }));

  if (orgRole === OrganizationUserRole.EXTERNAL) {
    // Viewer: only Viewer, no custom roles
    return [teamRolesOptions.VIEWER];
  }

  if (orgRole === OrganizationUserRole.MEMBER) {
    // Member: all except Viewer, plus custom roles
    return [
      ...baseRoles.filter((r) => r.value !== TeamUserRole.VIEWER),
      ...customRoleOptions,
    ];
  }

  // Admin: all roles plus custom roles
  return [...baseRoles, ...customRoleOptions];
}

/**
 * Get the default team role based on org role
 * - EXTERNAL (Viewer): Viewer
 * - MEMBER: Member
 * - ADMIN: Member
 */
function getDefaultTeamRole(orgRole: OrganizationUserRole): TeamUserRole {
  if (orgRole === OrganizationUserRole.EXTERNAL) {
    return TeamUserRole.VIEWER;
  }
  return TeamUserRole.MEMBER;
}

/**
 * TeamRoleSelect component - renders a dropdown for team roles including custom roles
 * Filters available roles based on organization role
 */
function TeamRoleSelect({
  index,
  teamIndex,
  control,
  organizationId,
  orgRole,
  setValue,
}: {
  index: number;
  teamIndex: number;
  control: Control<MembersForm>;
  organizationId: string;
  orgRole: OrganizationUserRole;
  setValue: UseFormSetValue<MembersForm>;
}) {
  const customRoles = api.role.getAll.useQuery({ organizationId });

  // Build role options filtered by org role
  const roleOptions = useMemo(
    () => getFilteredTeamRoles(orgRole, customRoles.data ?? []),
    [orgRole, customRoles.data],
  );

  const roleCollection = useMemo(
    () => createListCollection({ items: roleOptions }),
    [roleOptions],
  );

  return (
    <Controller
      control={control}
      name={`invites.${index}.teams.${teamIndex}.role`}
      render={({ field }) => {
        const handleValueChange = (details: { value: string[] }) => {
          const selectedValue = details.value[0];
          if (!selectedValue) return;

          field.onChange(selectedValue);

          // If it's a custom role, extract the roleId and set customRoleId
          if (selectedValue.startsWith("custom:")) {
            const customRoleId = selectedValue.replace("custom:", "");
            setValue(
              `invites.${index}.teams.${teamIndex}.customRoleId`,
              customRoleId,
            );
          } else {
            // Clear customRoleId for built-in roles
            setValue(
              `invites.${index}.teams.${teamIndex}.customRoleId`,
              undefined,
            );
          }
        };

        return (
          <Select.Root
            collection={roleCollection}
            value={[field.value]}
            onValueChange={handleValueChange}
            disabled={customRoles.isLoading}
          >
            <Select.Trigger background="bg" width="full">
              <Select.ValueText placeholder="Select role" />
            </Select.Trigger>
            <Select.Content paddingY={2} zIndex="popover" width="320px">
              {roleOptions.map((option) => (
                <Select.Item key={option.value} item={option}>
                  <TeamRoleSelectItemContent option={option} />
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        );
      }}
    />
  );
}
