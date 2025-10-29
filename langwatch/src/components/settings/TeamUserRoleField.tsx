import { Field, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { TeamUserRole } from "@prisma/client";
import { Select as MultiSelect, chakraComponents } from "chakra-react-select";
import { Controller, useForm, type SubmitHandler } from "react-hook-form";
import type { TeamMemberWithUser } from "../../server/api/routers/organization";
import { api } from "../../utils/api";
import { toaster } from "../../components/ui/toaster";

export type RoleOption = {
  label: string;
  value: string;
  description: string;
  isCustom?: boolean;
  customRoleId?: string;
};

export const teamRolesOptions: {
  [K in TeamUserRole]: RoleOption;
} = {
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
  const defaultRole = customRole
    ? ({
        label: customRole.name,
        value: `custom:${customRole.id}`,
        description:
          customRole.description ??
          `${customRole.permissions.length} permissions`,
        isCustom: true,
        customRoleId: customRole.id,
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
              field={{
                ...field,
                onChange: (value: any) => {
                  field.onChange(value);
                  void handleSubmit(onSubmit)();
                },
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
  field,
  organizationId,
}: {
  field: any;
  organizationId: string;
}) => {
  const customRoles = api.role.getAll.useQuery({ organizationId });

  const allRoleOptions: RoleOption[] = [
    ...Object.values(teamRolesOptions),
    ...(customRoles.data ?? []).map((role) => ({
      label: role.name,
      value: `custom:${role.id}`,
      description: role.description ?? `${role.permissions.length} permissions`,
      isCustom: true,
      customRoleId: role.id,
    })),
  ];

  return (
    <MultiSelect
      {...field}
      options={allRoleOptions}
      hideSelectedOptions={false}
      isSearchable={false}
      chakraStyles={{
        container: (base) => ({
          ...base,
          minWidth: "200px",
        }),
      }}
      useBasicStyles
      isLoading={customRoles.isLoading}
      components={{
        Menu: ({ children, ...props }) => (
          <chakraComponents.Menu
            {...props}
            innerProps={{
              ...props.innerProps,
              style: { width: "300px" },
            }}
          >
            {children}
          </chakraComponents.Menu>
        ),
        Option: ({ children, ...props }) => (
          <chakraComponents.Option {...props}>
            <VStack align="start">
              <HStack>
                <Text>{children}</Text>
                {(props.data as RoleOption).isCustom && (
                  <Text fontSize="xs" color="orange.500">
                    Custom
                  </Text>
                )}
              </HStack>
              <Text
                color={props.isSelected ? "white" : "gray.500"}
                fontSize="13px"
              >
                {(props.data as RoleOption).description}
              </Text>
            </VStack>
          </chakraComponents.Option>
        ),
      }}
    />
  );
};
