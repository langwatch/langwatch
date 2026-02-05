import {
  createListCollection,
  Field,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { TeamUserRole } from "@prisma/client";
import { useMemo } from "react";
import { Controller, type SubmitHandler, useForm } from "react-hook-form";
import { toaster } from "../../components/ui/toaster";
import type { TeamMemberWithUser } from "../../server/api/routers/organization";
import { api } from "../../utils/api";
import { Select } from "../ui/select";

export type RoleOption = {
  label: string;
  value: string;
  description: string;
  isCustom?: boolean;
  customRoleId?: string;
};

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

/**
 * Reusable component for rendering team role select item content
 */
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
  customRole,
}: {
  member: TeamMemberWithUser;
  organizationId: string;
  customRole?: {
    id: string;
    name: string;
    description: string | null;
    permissions: string[];
  };
}) => {
  const defaultRole: RoleOption =
    (customRole ?? member.role === TeamUserRole.CUSTOM)
      ? ({
          label: customRole?.name ?? "Custom Role",
          value: `custom:${customRole?.id ?? ""}`,
          description:
            customRole?.description ??
            `${customRole?.permissions.length ?? 0} permissions`,
          isCustom: true,
          customRoleId: customRole?.id,
        } as RoleOption)
      : teamRolesOptions[member.role];

  const {
    control,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
  } = useForm<TeamUserRoleForm>({
    defaultValues: {
      role: defaultRole,
    },
  });

  const updateTeamMemberRoleMutation =
    api.organization.updateTeamMemberRole.useMutation();

  const onSubmit: SubmitHandler<TeamUserRoleForm> = (data) => {
    updateTeamMemberRoleMutation.mutate(
      {
        teamId: member.teamId,
        userId: member.userId,
        role: data.role.value,
        customRoleId: data.role.customRoleId,
      },
      {
        onError: () => {
          toaster.create({
            title: "Failed to update user role",
            description:
              "You need administrator permissions to update this user's role",
            type: "error",
            meta: {
              closable: true,
            },
          });
          resetForm();
        },
      },
    );
  };

  return (
    <VStack align="start">
      <Controller
        control={control}
        name={`role`}
        rules={{ required: "User role is required" }}
        render={({ field }) => (
          <HStack gap={6}>
            <TeamRoleSelect
              organizationId={organizationId}
              value={field.value}
              onChange={(value: RoleOption) => {
                field.onChange(value);
                void handleSubmit(onSubmit)();
              }}
            />
            {updateTeamMemberRoleMutation.isLoading && <Spinner size="sm" />}
          </HStack>
        )}
      />
      <Field.ErrorText>{errors.role && "Role is required"}</Field.ErrorText>
    </VStack>
  );
};

/**
 * TeamRoleSelect component
 *
 * Single Responsibility: Renders a dropdown selector for team roles (built-in and custom)
 */
export const TeamRoleSelect = ({
  value,
  onChange,
  organizationId,
}: {
  value: RoleOption;
  onChange: (value: RoleOption) => void;
  organizationId: string;
}) => {
  const customRoles = api.role.getAll.useQuery({ organizationId });

  const allRoleOptions: RoleOption[] = useMemo(
    () => [
      ...Object.values(teamRolesOptions),
      ...(customRoles.data ?? []).map((role) => ({
        label: role.name,
        value: `custom:${role.id}`,
        description: role.description ?? `${role.permissions.length} permissions`,
        isCustom: true,
        customRoleId: role.id,
      })),
    ],
    [customRoles.data],
  );

  const roleCollection = useMemo(
    () => createListCollection({ items: allRoleOptions }),
    [allRoleOptions],
  );

  return (
    <Select.Root
      collection={roleCollection}
      value={[value.value]}
      onValueChange={(details) => {
        const selectedValue = details.value[0];
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
