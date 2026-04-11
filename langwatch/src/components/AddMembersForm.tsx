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
  type SubmitHandler,
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
  role: TeamUserRole | string;
  customRoleId?: string;
};

type InviteData = {
  email: string;
  orgRole: OrganizationUserRole;
  teams: TeamAssignment[];
};

export type MembersForm = {
  invites: InviteData[];
};

// Internal form shape — flattened: one email input, shared role + teams
type InternalForm = {
  emailsRaw: string;
  orgRole: OrganizationUserRole;
  teams: TeamAssignment[];
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
  isInviterAdmin?: boolean;
}

export function AddMembersForm({
  teamOptions,
  orgRoleOptions,
  organizationId,
  onSubmit,
  isLoading = false,
  hasEmailProvider = false,
  onClose,
  onCloseText = "Cancel",
  isInviterAdmin = true,
}: AddMembersFormProps) {
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<InternalForm>({
    defaultValues: {
      emailsRaw: "",
      orgRole: OrganizationUserRole.MEMBER,
      teams:
        teamOptions.length > 0
          ? [{ teamId: teamOptions[0]?.value ?? "", role: TeamUserRole.MEMBER }]
          : [],
    },
  });

  const { fields: teamFields, append: appendTeam, remove: removeTeam } = useFieldArray({
    control,
    name: "teams",
  });

  const selectedTeams = useWatch({ control, name: "teams" });
  const orgRole = useWatch({ control, name: "orgRole" }) as OrganizationUserRole;
  const prevOrgRoleRef = useRef<OrganizationUserRole>(orgRole);

  useEffect(() => {
    if (prevOrgRoleRef.current !== orgRole && selectedTeams?.length > 0) {
      selectedTeams.forEach((team: TeamAssignment | undefined, teamIndex: number) => {
        if (!team) return;
        if (orgRole === OrganizationUserRole.EXTERNAL) {
          if (team.role !== TeamUserRole.VIEWER) {
            setValue(`teams.${teamIndex}.role`, TeamUserRole.VIEWER);
            setValue(`teams.${teamIndex}.customRoleId`, undefined);
          }
        } else if (orgRole === OrganizationUserRole.MEMBER) {
          if (team.role === TeamUserRole.VIEWER) {
            setValue(`teams.${teamIndex}.role`, TeamUserRole.MEMBER);
          }
        }
      });
    }
    prevOrgRoleRef.current = orgRole;
  }, [orgRole, selectedTeams, setValue]);

  const getAvailableTeamOptions = (currentTeamIndex?: number) => {
    const selectedTeamIds = selectedTeams
      ?.map((team: TeamAssignment | undefined, idx: number) => {
        if (currentTeamIndex !== undefined && idx === currentTeamIndex) return null;
        return team?.teamId;
      })
      .filter((id: string | null | undefined): id is string => !!id && id !== "");
    return teamOptions.filter((opt) => !selectedTeamIds?.includes(opt.value));
  };

  const handleAddTeam = () => {
    const available = getAvailableTeamOptions();
    if (available.length > 0) {
      appendTeam({ teamId: available[0]?.value ?? "", role: getDefaultTeamRole(orgRole) });
    }
  };

  const orgRoleCollection = useMemo(
    () => createListCollection({ items: orgRoleOptions }),
    [orgRoleOptions],
  );

  const handleInternalSubmit = (data: InternalForm) => {
    const emails = data.emailsRaw
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter(Boolean);

    // Normalize team roles to match org role constraints
    const normalizedTeams = data.teams.map((team) => {
      if (data.orgRole === OrganizationUserRole.EXTERNAL) {
        return { teamId: team.teamId, role: TeamUserRole.VIEWER, customRoleId: undefined };
      }
      if (data.orgRole === OrganizationUserRole.MEMBER && team.role === TeamUserRole.VIEWER) {
        return { ...team, role: TeamUserRole.MEMBER, customRoleId: undefined };
      }
      return team;
    });

    const invites: InviteData[] = emails.map((email) => ({
      email,
      orgRole: data.orgRole,
      teams: normalizedTeams,
    }));
    return onSubmit({ invites });
  };

  return (
    <form onSubmit={handleSubmit(handleInternalSubmit)}>
      <VStack align="start" gap={4} width="100%">
        <HStack gap={4} align="start" width="full">
          <Field.Root flex="2" invalid={!!errors.emailsRaw}>
            <Field.Label>Email addresses</Field.Label>
            <Input
              placeholder="alice@example.com, bob@example.com"
              {...register("emailsRaw", {
                required: "At least one email is required",
                validate: (value) => {
                  const emails = value.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
                  if (emails.length === 0) return "At least one email is required";
                  const invalid = emails.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
                  if (invalid) return `Invalid email: ${invalid}`;
                  return true;
                },
              })}
            />
            <Field.ErrorText>{errors.emailsRaw?.message}</Field.ErrorText>
          </Field.Root>
          <Field.Root flex="1">
            <Field.Label>Org Role</Field.Label>
            <Controller
              control={control}
              name="orgRole"
              render={({ field }) => (
                <Select.Root
                  collection={orgRoleCollection}
                  value={[field.value]}
                  onValueChange={(details) => {
                    const val = details.value[0];
                    if (val) field.onChange(val);
                  }}
                >
                  <Select.Trigger>
                    <Select.ValueText placeholder="Select role" />
                  </Select.Trigger>
                  <Select.Content paddingY={2} width="320px">
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
        </HStack>

        {teamFields.length > 0 && (
          <VStack align="start" gap={2} width="100%">
            <HStack justify="space-between" width="100%">
              <Text fontSize="sm" fontWeight="medium" color="fg">
                Team Assignments
              </Text>
              <Button
                type="button"
                size="sm"
                variant="ghost"
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
                    <Table.ColumnHeader paddingLeft={0} paddingTop={0}>Team</Table.ColumnHeader>
                    <Table.ColumnHeader paddingLeft={0} paddingTop={0}>Role</Table.ColumnHeader>
                    <Table.ColumnHeader paddingLeft={0} paddingRight={0} paddingTop={0} width="50px" />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {teamFields.map((teamField, teamIndex) => (
                    <Table.Row key={teamField.id} backgroundColor="transparent">
                      <Table.Cell paddingLeft={0}>
                        <TeamSelect
                          teamIndex={teamIndex}
                          control={control}
                          getAvailableTeamOptions={getAvailableTeamOptions}
                        />
                      </Table.Cell>
                      <Table.Cell paddingLeft={0}>
                        <TeamRoleSelect
                          teamIndex={teamIndex}
                          control={control}
                          organizationId={organizationId}
                          orgRole={orgRole}
                          setValue={setValue}
                          isInviterAdmin={isInviterAdmin}
                        />
                      </Table.Cell>
                      <Table.Cell paddingLeft={0} paddingRight={0} paddingY={2}>
                        <Button
                          type="button"
                          size="sm"
                          colorPalette="red"
                          variant="ghost"
                          aria-label="Remove team assignment"
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

        <HStack justify="end" width="100%" marginTop={4}>
          <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
            {onCloseText}
          </Button>
          <Button colorPalette={isLoading ? "gray" : "orange"} type="submit" disabled={isLoading}>
            <HStack>
              {isLoading ? <Spinner size="sm" /> : <Mail size={18} />}
              <Text>{hasEmailProvider ? "Send invites" : "Create invites"}</Text>
            </HStack>
          </Button>
        </HStack>
      </VStack>
    </form>
  );
}

function TeamSelect({
  teamIndex,
  control,
  getAvailableTeamOptions,
}: {
  teamIndex: number;
  control: Control<InternalForm>;
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
      name={`teams.${teamIndex}.teamId`}
      rules={{ required: "Team is required" }}
      render={({ field }) => (
        <Select.Root
          collection={teamCollection}
          value={[field.value]}
          onValueChange={(details) => {
            const val = details.value[0];
            if (val) field.onChange(val);
          }}
        >
          <Select.Trigger background="bg" width="full">
            <Select.ValueText placeholder="Select team" />
          </Select.Trigger>
          <Select.Content paddingY={2}>
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

function getFilteredTeamRoles(
  orgRole: OrganizationUserRole,
  customRoles: Array<{ id: string; name: string; description?: string | null }>,
  isInviterAdmin: boolean,
): RoleOption[] {
  const baseRoles = Object.values(teamRolesOptions);
  const customRoleOptions: RoleOption[] = customRoles.map((role) => ({
    label: role.name,
    value: `custom:${role.id}`,
    description: role.description ?? `Custom role`,
    isCustom: true,
    customRoleId: role.id,
  }));

  if (orgRole === OrganizationUserRole.EXTERNAL) return [teamRolesOptions.VIEWER];
  if (orgRole === OrganizationUserRole.MEMBER) {
    if (!isInviterAdmin) return [teamRolesOptions.MEMBER];
    return [...baseRoles.filter((r) => r.value !== TeamUserRole.VIEWER), ...customRoleOptions];
  }
  return [...baseRoles, ...customRoleOptions];
}

function getDefaultTeamRole(orgRole: OrganizationUserRole): TeamUserRole {
  return orgRole === OrganizationUserRole.EXTERNAL ? TeamUserRole.VIEWER : TeamUserRole.MEMBER;
}

function TeamRoleSelect({
  teamIndex,
  control,
  organizationId,
  orgRole,
  setValue,
  isInviterAdmin,
}: {
  teamIndex: number;
  control: Control<InternalForm>;
  organizationId: string;
  orgRole: OrganizationUserRole;
  setValue: UseFormSetValue<InternalForm>;
  isInviterAdmin: boolean;
}) {
  const customRoles = api.role.getAll.useQuery({ organizationId });

  const roleOptions = useMemo(
    () => getFilteredTeamRoles(orgRole, customRoles.data ?? [], isInviterAdmin),
    [orgRole, customRoles.data, isInviterAdmin],
  );

  const roleCollection = useMemo(
    () => createListCollection({ items: roleOptions }),
    [roleOptions],
  );

  return (
    <Controller
      control={control}
      name={`teams.${teamIndex}.role`}
      render={({ field }) => {
        const handleValueChange = (details: { value: string[] }) => {
          const val = details.value[0];
          if (!val) return;
          field.onChange(val);
          if (val.startsWith("custom:")) {
            setValue(`teams.${teamIndex}.customRoleId`, val.replace("custom:", ""));
          } else {
            setValue(`teams.${teamIndex}.customRoleId`, undefined);
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
            <Select.Content paddingY={2} width="320px">
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
