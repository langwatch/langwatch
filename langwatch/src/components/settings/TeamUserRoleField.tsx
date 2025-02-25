import { Field, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { TeamUserRole } from "@prisma/client";
import { Select as MultiSelect, chakraComponents } from "chakra-react-select";
import { Controller, useForm, type SubmitHandler } from "react-hook-form";
import type { TeamMemberWithUser } from "../../server/api/routers/organization";
import { api } from "../../utils/api";
import { toaster } from "../../components/ui/toaster";

export const teamRolesOptions: {
  [K in TeamUserRole]: { label: string; value: K; description: string };
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
  role: (typeof teamRolesOptions)[TeamUserRole];
};

export const TeamUserRoleField = ({
  member,
}: {
  member: TeamMemberWithUser;
}) => {
  const {
    control,
    handleSubmit,
    formState: { errors },
    reset: resetForm,
  } = useForm<TeamUserRoleForm>({
    defaultValues: {
      role: teamRolesOptions[member.role],
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
      },
      {
        onError: () => {
          toaster.create({
            title: "Failed to update user role",
            description: "Please try that again",
            type: "error",
            meta: {
              closable: true,
            },
            placement: "top-end",
          });
          resetForm();
        },
      }
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

// TODO: replace those anys with proper types
export const TeamRoleSelect = ({ field }: { field: any }) => {
  return (
    <MultiSelect
      {...field}
      options={Object.values(teamRolesOptions)}
      hideSelectedOptions={false}
      isSearchable={false}
      useBasicStyles
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
              <Text>{children}</Text>
              <Text
                color={props.isSelected ? "white" : "gray.500"}
                fontSize="13px"
              >
                {(props.data as any).description}
              </Text>
            </VStack>
          </chakraComponents.Option>
        ),
      }}
    />
  );
};
