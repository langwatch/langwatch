import {
  createListCollection,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { useMemo } from "react";
import type { TeamMemberWithUser } from "../../server/api/routers/organization";
import { api } from "../../utils/api";
import {
  getAutoCorrectedTeamRoleForOrganizationRole,
  isTeamRoleAllowedForOrganizationRole,
  type TeamRoleValue,
} from "../../utils/memberRoleConstraints";
import { Select } from "../ui/select";

export type RoleOption = {
  label: string;
  value: TeamRoleValue;
  description: string;
  isCustom?: boolean;
  customRoleId?: string;
};

export const MISSING_CUSTOM_ROLE_VALUE = "custom:missing";

export const teamRolesOptions: Record<
  "ADMIN" | "MEMBER" | "VIEWER",
  RoleOption
> = {
  [TeamUserRole.ADMIN]: {
    label: "Admin",
    value: TeamUserRole.ADMIN,
    description: "Can manage team and add or remove members",
  },
  [TeamUserRole.MEMBER]: {
    label: "Member",
    value: TeamUserRole.MEMBER,
    description: "Can setup the project, see costs, add or remove guardrails",
  },
  [TeamUserRole.VIEWER]: {
    label: "Viewer",
    value: TeamUserRole.VIEWER,
    description:
      "Can only view analytics, messages and guardrails results, cannot see costs, debugging data or modify anything",
  },
};

export type TeamUserRoleForm = {
  role: RoleOption;
};

export const TeamRoleSelectItemContent = ({
  option,
}: {
  option: RoleOption;
}) => (
  <VStack align="start" gap={0} flex={1}>
    <HStack>
      <Text>{option.label}</Text>
      {option.isCustom && (
        <Text fontSize="xs" color="orange.solid">
          Custom
        </Text>
      )}
    </HStack>
    <Text color="fg.muted" fontSize="13px">
      {option.description}
    </Text>
  </VStack>
);

export const TeamUserRoleField = ({
  member,
  organizationId,
  organizationRole,
  customRole,
  value,
  onChange,
}: {
  member: TeamMemberWithUser;
  organizationId: string;
  organizationRole: OrganizationUserRole;
  customRole?: {
    id: string;
    name: string;
    description: string | null;
    permissions: string[];
  };
  value?: string;
  onChange: (value: RoleOption) => void;
}) => {
  const selectedRoleValue: TeamRoleValue =
    (value as TeamRoleValue | undefined) ??
    (member.role === TeamUserRole.CUSTOM && customRole
      ? `custom:${customRole.id}`
      : member.role);

  const selectedRole: RoleOption =
    selectedRoleValue === TeamUserRole.CUSTOM ||
    selectedRoleValue === MISSING_CUSTOM_ROLE_VALUE
      ? {
          label: "Missing Custom Role",
          value: MISSING_CUSTOM_ROLE_VALUE,
          description:
            "This member references a deleted or unavailable custom role",
        }
      : selectedRoleValue.startsWith("custom:")
        ? {
            label: customRole?.name ?? "Custom Role",
            value: selectedRoleValue,
            description:
              customRole?.description ??
              `${customRole?.permissions.length ?? 0} permissions`,
            isCustom: true,
            customRoleId: selectedRoleValue.replace("custom:", ""),
          }
        : teamRolesOptions[
            selectedRoleValue as Exclude<TeamUserRole, "CUSTOM">
          ];

  return (
    <VStack align="start">
      <HStack gap={6}>
        <TeamRoleSelect
          organizationId={organizationId}
          organizationRole={organizationRole}
          value={selectedRole}
          onChange={onChange}
        />
      </HStack>
      {selectedRole.value === MISSING_CUSTOM_ROLE_VALUE ? (
        <Text color="red.fg" fontSize="sm">
          Resolve this role before saving changes.
        </Text>
      ) : null}
    </VStack>
  );
};

export const TeamRoleSelect = ({
  value,
  onChange,
  organizationId,
  organizationRole,
}: {
  value: RoleOption;
  onChange: (value: RoleOption) => void;
  organizationId: string;
  organizationRole: OrganizationUserRole;
}) => {
  const customRoles = api.role.getAll.useQuery({ organizationId });

  const allRoleOptions = useMemo(
    () => {
      const constrainedOptions = [
        ...Object.values(teamRolesOptions),
        ...(customRoles.data ?? []).map((role): RoleOption => ({
          label: role.name,
          value: `custom:${role.id}`,
          description:
            role.description ?? `${role.permissions.length} permissions`,
          isCustom: true,
          customRoleId: role.id,
        })),
      ].filter((option) =>
        isTeamRoleAllowedForOrganizationRole({
          organizationRole,
          teamRole: option.value,
        }),
      );

      if (
        value.value === MISSING_CUSTOM_ROLE_VALUE &&
        !constrainedOptions.some((option) => option.value === value.value)
      ) {
        return [value, ...constrainedOptions];
      }

      return constrainedOptions;
    },
    [customRoles.data, organizationRole, value],
  );

  const correctedSelectedRole = useMemo(() => {
    const correctedValue = getAutoCorrectedTeamRoleForOrganizationRole({
      organizationRole,
      currentTeamRole: value.value,
    });
    return allRoleOptions.find((option) => option.value === correctedValue);
  }, [allRoleOptions, organizationRole, value.value]);

  const roleCollection = useMemo(
    () => createListCollection({ items: allRoleOptions }),
    [allRoleOptions],
  );

  return (
    <Select.Root
      collection={roleCollection}
      value={[correctedSelectedRole?.value ?? value.value]}
      onValueChange={(details) => {
        const selectedValue = details.value[0] as TeamRoleValue | undefined;
        if (selectedValue) {
          const selectedOption = allRoleOptions.find(
            (o) => o.value === selectedValue,
          );
          if (selectedOption) {
            onChange(selectedOption);
          }
        }
      }}
      disabled={customRoles.isLoading}
    >
      <Select.Trigger width="200px" background="bg">
        <Select.ValueText placeholder="Select role" />
      </Select.Trigger>
      <Select.Content width="300px" paddingY={2}>
        {allRoleOptions.map((option) => (
          <Select.Item key={option.value} item={option}>
            <TeamRoleSelectItemContent option={option} />
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
};
