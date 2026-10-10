import {
  Box,
  Button,
  Card,
  createListCollection,
  Heading,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import { Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import {
  type Control,
  Controller,
  type UseFormSetValue,
  useFieldArray,
  useWatch,
} from "react-hook-form";

import { api } from "../../behavior/organization-api.ts";
import {
  availableTeamOptions,
  type InviteFormValues,
  type TeamOption,
} from "../../model/add-members-form-model.ts";
import { getDefaultTeamRoleForOrganizationRole } from "../../model/member-role-constraints.ts";
import { OrganizationUserRole, TeamUserRole } from "../../model/prisma-types.ts";
import { SEAT_TYPE_COPY } from "../../model/seat-type-copy.ts";
import {
  type RoleOption,
  TeamRoleSelectItemContent,
  teamRolesOptions,
} from "./team-user-role-field.tsx";

type TeamAssignmentsProps = {
  control: Control<InviteFormValues>;
  setValue: UseFormSetValue<InviteFormValues>;
  teamOptions: TeamOption[];
  orgRole: OrganizationUserRole;
  organizationId: string;
  isInviterAdmin: boolean;
};

/**
 * The invite's team rows, in the team drawer's row editor: a card holding a
 * row per staged team and the button to stage one more. A Developer seat
 * (ADR-171) joins no team, so it gets a notice instead.
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
  return (
    <VStack align="start" gap={3} width="100%" marginTop={2}>
      <Heading>Team Assignments</Heading>
      {fields.length === 0 && orgRole === OrganizationUserRole.EXTERNAL && (
        <LiteMemberNeedsTeamWarning />
      )}
      <TeamAssignmentTable
        {...props}
        rowIds={fields.map((field) => field.id)}
        optionsFor={optionsFor}
        onRemove={remove}
        canAddTeam={canAddTeam}
        onAddTeam={addTeam}
      />
    </VStack>
  );
}

function DeveloperNoTeamNotice() {
  return (
    <Text fontSize="xs" color="fg.muted" data-testid="developer-no-team">
      A Developer gets a project of their own and joins no team. You can move them to a Member seat
      later from the members list.
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
        {SEAT_TYPE_COPY.liteMemberNeedsTeamWarning}
      </Text>
    </Box>
  );
}

function TeamAssignmentTable({
  rowIds,
  optionsFor,
  onRemove,
  canAddTeam,
  onAddTeam,
  ...rowProps
}: TeamAssignmentsProps & {
  rowIds: string[];
  optionsFor: (exceptIndex?: number) => TeamOption[];
  onRemove: (index: number) => void;
  canAddTeam: boolean;
  onAddTeam: () => void;
}) {
  return (
    <Card.Root width="full" overflow="hidden">
      <Card.Body paddingY={0} paddingX={0}>
        <Table.Root variant="line" width="full">
          {rowIds.length > 0 && (
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader width="48%">Team</Table.ColumnHeader>
                <Table.ColumnHeader>Role</Table.ColumnHeader>
                <Table.ColumnHeader width="60px" />
              </Table.Row>
            </Table.Header>
          )}
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
            <Table.Row>
              <Table.Cell colSpan={3}>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onAddTeam}
                  disabled={!canAddTeam}
                >
                  <Plus size={18} /> Add team
                </Button>
              </Table.Cell>
            </Table.Row>
          </Table.Body>
        </Table.Root>
      </Card.Body>
    </Card.Root>
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
    <Table.Row>
      <Table.Cell>
        <TeamSelect teamIndex={teamIndex} control={control} options={options} />
      </Table.Cell>
      <Table.Cell>
        <TeamRoleSelect
          teamIndex={teamIndex}
          control={control}
          organizationId={organizationId}
          orgRole={orgRole}
          setValue={setValue}
          isInviterAdmin={isInviterAdmin}
        />
      </Table.Cell>
      <Table.Cell paddingLeft={0} paddingY={2}>
        <Button
          type="button"
          variant="ghost"
          color="red.fg"
          aria-label="Remove team assignment"
          onClick={onRemove}
        >
          <Trash2 size={18} />
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
  const teamCollection = useMemo(() => createListCollection({ items: options }), [options]);

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
          <Select.Trigger width="full">
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
  customRoles: { id: string; name: string; description?: string | null }[],
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

  const roleCollection = useMemo(() => createListCollection({ items: roleOptions }), [roleOptions]);

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
            <Select.Trigger width="full">
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
