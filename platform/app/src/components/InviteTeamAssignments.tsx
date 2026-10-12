import {
  Box,
  Button,
  createListCollection,
  HStack,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import {
  type Control,
  Controller,
  type UseFormSetValue,
  useFieldArray,
  useWatch,
} from "react-hook-form";
import { OrganizationUserRole, TeamUserRole } from "~/generated/prisma/client";
import { api } from "~/utils/api";
import { getDefaultTeamRoleForOrganizationRole } from "~/utils/memberRoleConstraints";
import {
  availableTeamOptions,
  type InviteFormValues,
  type TeamOption,
} from "./addMembersFormModel";
import { LITE_MEMBER_NEEDS_TEAM_WARNING } from "./settings/seatTypeCopy";
import {
  type RoleOption,
  TeamRoleSelectItemContent,
  teamRolesOptions,
} from "./settings/TeamUserRoleField";
import { Select } from "./ui/select";

type TeamAssignmentsProps = {
  control: Control<InviteFormValues>;
  setValue: UseFormSetValue<InviteFormValues>;
  teamOptions: TeamOption[];
  orgRole: OrganizationUserRole;
  organizationId: string;
  isInviterAdmin: boolean;
};

/**
 * The invite's team rows: a table once a team is staged, otherwise the
 * button to stage one. A Developer seat (ADR-143) joins no team, so it gets
 * a notice instead of either.
 */
export function InviteTeamAssignments(props: TeamAssignmentsProps) {
  const { control, teamOptions, orgRole } = props;
  const { fields, append, remove } = useFieldArray({ control, name: "teams" });
  const selectedTeams = useWatch({ control, name: "teams" });

  const optionsFor = (exceptIndex?: number) =>
    availableTeamOptions({ teamOptions, selectedTeams, exceptIndex });
  const canAddTeam = optionsFor().length > 0;
  const addTeam = () => {
    const first = optionsFor()[0];
    if (!first) return;
    append({
      teamId: first.value,
      role: getDefaultTeamRoleForOrganizationRole(orgRole),
    });
  };

  if (orgRole === OrganizationUserRole.DEVELOPER) {
    return <DeveloperNoTeamNotice />;
  }
  if (fields.length === 0) {
    return (
      <NoTeamAssignments
        isLiteSeat={orgRole === OrganizationUserRole.EXTERNAL}
        canAddTeam={canAddTeam}
        onAddTeam={addTeam}
      />
    );
  }
  return (
    <VStack align="start" gap={2} width="100%">
      <HStack justify="space-between" width="100%">
        <Text fontSize="sm" fontWeight="medium" color="fg">
          Team Assignments
        </Text>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={addTeam}
          disabled={!canAddTeam}
        >
          <Plus size={14} /> Add team
        </Button>
      </HStack>
      <TeamAssignmentTable
        {...props}
        rowIds={fields.map((field) => field.id)}
        optionsFor={optionsFor}
        onRemove={remove}
      />
    </VStack>
  );
}

function DeveloperNoTeamNotice() {
  return (
    <Text fontSize="xs" color="fg.muted" data-testid="developer-no-team">
      A Developer gets a project of their own and joins no team. You can move
      them to a Member seat later from the members list.
    </Text>
  );
}

/**
 * Shown when a lite invite names no team. A lite seat grants nothing on its
 * own, so without a team the person can sign in and see nothing — and the
 * admin only finds out when they say so.
 */
function LiteMemberNeedsTeamWarning() {
  return (
    <Box
      paddingX={4}
      paddingY={3}
      backgroundColor="orange.subtle"
      borderRadius="xl"
      width="100%"
      data-testid="lite-member-needs-team-warning"
    >
      <Text fontSize="sm" color="fg">
        {LITE_MEMBER_NEEDS_TEAM_WARNING}
      </Text>
    </Box>
  );
}

function NoTeamAssignments({
  isLiteSeat,
  canAddTeam,
  onAddTeam,
}: {
  isLiteSeat: boolean;
  canAddTeam: boolean;
  onAddTeam: () => void;
}) {
  return (
    <VStack align="start" gap={2} width="100%">
      {isLiteSeat && <LiteMemberNeedsTeamWarning />}
      <HStack gap={2}>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onAddTeam}
          disabled={!canAddTeam}
        >
          <Plus size={14} /> Add team
        </Button>
      </HStack>
    </VStack>
  );
}

function TeamAssignmentTable({
  rowIds,
  optionsFor,
  onRemove,
  ...rowProps
}: TeamAssignmentsProps & {
  rowIds: string[];
  optionsFor: (exceptIndex?: number) => TeamOption[];
  onRemove: (index: number) => void;
}) {
  return (
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
            />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rowIds.map((rowId, teamIndex) => (
            <TeamAssignmentRow
              key={rowId}
              {...rowProps}
              teamIndex={teamIndex}
              options={optionsFor(teamIndex)}
              onRemove={() => onRemove(teamIndex)}
            />
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

function TeamAssignmentRow({
  control,
  setValue,
  orgRole,
  organizationId,
  isInviterAdmin,
  teamIndex,
  options,
  onRemove,
}: TeamAssignmentsProps & {
  teamIndex: number;
  options: TeamOption[];
  onRemove: () => void;
}) {
  return (
    <Table.Row backgroundColor="transparent">
      <Table.Cell paddingLeft={0}>
        <TeamSelect teamIndex={teamIndex} control={control} options={options} />
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
          onClick={onRemove}
        >
          <Trash2 size={16} />
        </Button>
      </Table.Cell>
    </Table.Row>
  );
}

function TeamSelect({
  teamIndex,
  control,
  options,
}: {
  teamIndex: number;
  control: Control<InviteFormValues>;
  options: TeamOption[];
}) {
  const teamCollection = useMemo(
    () => createListCollection({ items: options }),
    [options],
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
            {options.map((option) => (
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

  if (orgRole === OrganizationUserRole.EXTERNAL)
    return [teamRolesOptions.VIEWER];
  if (orgRole === OrganizationUserRole.MEMBER) {
    if (!isInviterAdmin) return [teamRolesOptions.MEMBER];
    return [
      ...baseRoles.filter((r) => r.value !== TeamUserRole.VIEWER),
      ...customRoleOptions,
    ];
  }
  return [...baseRoles, ...customRoleOptions];
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
  control: Control<InviteFormValues>;
  organizationId: string;
  orgRole: OrganizationUserRole;
  setValue: UseFormSetValue<InviteFormValues>;
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
            setValue(
              `teams.${teamIndex}.customRoleId`,
              val.replace("custom:", ""),
            );
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
