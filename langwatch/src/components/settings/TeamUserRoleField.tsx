"use client";

import {
  Field,
  HStack,
  Portal,
  Select,
  Span,
  Spinner,
  Stack,
import {
  Field,
  HStack,
  Portal,
  Select,
  Span,
  Spinner,
  Stack,
  VStack,
  createListCollection,
} from "@chakra-ui/react";
  VStack,
  createListCollection,
} from "@chakra-ui/react";
import { TeamUserRole } from "@prisma/client";
import { Controller, type SubmitHandler, useForm } from "react-hook-form";
import { toaster } from "../../components/ui/toaster";
import type { TeamMemberWithUser } from "../../server/api/routers/organization";
import { api } from "../../utils/api";

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
              field={{
                ...field,
                onChange: (value: any) => {
                  field.onChange(value);
                  void handleSubmit(onSubmit)();
                },
              }}
            />
            {updateTeamMemberRoleMutation.isPending && <Spinner size="sm" />}
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

  const collection = createListCollection({
    items: allRoleOptions,
  });

  return (
    <Select.Root
      collection={collection}
      size="sm"
      width="220px"
      value={field.value ? [field.value.value] : []}
      onValueChange={({ value }) => {
        const selectedOption = allRoleOptions.find(
          (option) => option.value === value[0]
        );
        if (selectedOption) {
          field.onChange(selectedOption);
        }
      }}
      positioning={{ sameWidth: false }}
    >
      <Select.HiddenSelect />
      <Select.Control>
        <Select.Trigger>
          <Select.ValueText placeholder="Select role" />
        </Select.Trigger>
        <Select.IndicatorGroup>
          {customRoles.isLoading ? (
            <Spinner size="xs" />
          ) : (
            <Select.Indicator />
          )}
        </Select.IndicatorGroup>
      </Select.Control>
      <Portal>
        <Select.Positioner>
          <Select.Content minWidth="320px" paddingY={1}>
            {allRoleOptions.map((role) => (
              <Select.Item item={role} key={role.value} paddingY={2.5}>
                <Stack gap="0.5" maxWidth="280px">
                  <HStack gap={2}>
                    <Select.ItemText fontWeight="500" wordBreak="break-word">
                      {role.label}
                    </Select.ItemText>
                    {role.isCustom && (
                      <Span fontSize="xs" color="orange.500" flexShrink={0}>
                        Custom
                      </Span>
                    )}
                  </HStack>
                  <Span color="fg.muted" textStyle="xs" wordBreak="break-word">
                    {role.description}
                  </Span>
                </Stack>
                <Select.ItemIndicator />
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Positioner>
      </Portal>
    </Select.Root>
  );
};
