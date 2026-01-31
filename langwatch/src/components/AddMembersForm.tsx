import {
  Box,
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
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { Mail, Plus, Trash2 } from "lucide-react";
import {
  Controller,
  type SubmitHandler,
  type UseFormSetValue,
  useFieldArray,
  useForm,
  useWatch,
} from "react-hook-form";
import { useEffect, useMemo, useRef } from "react";
import { api } from "~/utils/api";

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
  control: any;
  register: any;
  errors: any;
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
          const isBuiltInRole = Object.values(TeamUserRole).includes(
            currentRole as TeamUserRole,
          );

          if (orgRole === OrganizationUserRole.EXTERNAL) {
            // Lite Member: force all team roles to Viewer
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

  return (
    <VStack align="stretch" gap={4} width="full">
      <HStack gap={4} align="start">
        <Field.Root flex="1">
          <Field.Label>Email</Field.Label>
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
        <Field.Root flex="1">
          <Field.Label>Org Role</Field.Label>
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
                <NativeSelect.Indicator />
              </NativeSelect.Root>
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
          marginLeft={4}
          paddingRight={3}
          align="start"
          gap={2}
          width="100%"
        >
          <HStack paddingLeft={4} justify="space-between" width="100%">
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
            paddingLeft={4}
            paddingY={3}
            backgroundColor="gray.300"
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
                    width="60px"
                  ></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {teamFields.map((teamField, teamIndex) => (
                  <Table.Row key={teamField.id} backgroundColor="transparent">
                    <Table.Cell paddingLeft={0}>
                      <Controller
                        control={control}
                        name={`invites.${index}.teams.${teamIndex}.teamId`}
                        rules={{ required: "Team is required" }}
                        render={({ field }) => {
                          const availableOptions =
                            getAvailableTeamOptions(teamIndex);
                          return (
                            <NativeSelect.Root>
                              <NativeSelect.Field
                                {...field}
                                backgroundColor="white"
                              >
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
                              <NativeSelect.Indicator />
                            </NativeSelect.Root>
                          );
                        }}
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
        <HStack gap={2} paddingLeft={4} marginLeft={4}>
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
 * Get the appropriate team role options based on org role
 * - EXTERNAL (Lite Member): only Viewer
 * - MEMBER: all except Viewer (+ custom roles)
 * - ADMIN: all roles (+ custom roles)
 */
function getFilteredTeamRoles(
  orgRole: OrganizationUserRole,
  customRoles: Array<{ id: string; name: string }>,
): Array<{ label: string; value: string; customRoleId?: string }> {
  const baseRoles = [
    { label: "Admin", value: TeamUserRole.ADMIN },
    { label: "Member", value: TeamUserRole.MEMBER },
    { label: "Viewer", value: TeamUserRole.VIEWER },
  ];

  const customRoleOptions = customRoles.map((role) => ({
    label: `${role.name} (Custom)`,
    value: `custom:${role.id}`,
    customRoleId: role.id,
  }));

  if (orgRole === OrganizationUserRole.EXTERNAL) {
    // Lite Member: only Viewer, no custom roles
    return [{ label: "Viewer", value: TeamUserRole.VIEWER }];
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
 * - EXTERNAL (Lite Member): Viewer
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
  control: any;
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

  return (
    <Controller
      control={control}
      name={`invites.${index}.teams.${teamIndex}.role`}
      render={({ field }) => {
        // When a custom role is selected, also update customRoleId
        const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
          const selectedValue = e.target.value;
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
          <NativeSelect.Root>
            <NativeSelect.Field {...field} onChange={handleChange}>
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        );
      }}
    />
  );
}
