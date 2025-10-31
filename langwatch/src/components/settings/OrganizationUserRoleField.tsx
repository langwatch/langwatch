import { HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { OrganizationUserRole } from "@prisma/client";
import { useMemo, useState, useEffect } from "react";
import { api } from "../../utils/api";
import { toaster } from "../ui/toaster";
import { Select as MultiSelect, chakraComponents } from "chakra-react-select";

type OrgRoleOption = {
  label: string;
  value: OrganizationUserRole;
  description: string;
};

const orgRoleOptions: OrgRoleOption[] = [
  {
    label: "Organization Admin",
    value: OrganizationUserRole.ADMIN,
    description: "Can manage organization and add or remove members",
  },
  {
    label: "Organization Member",
    value: OrganizationUserRole.MEMBER,
    description: "Can manage their own projects and view other projects",
  },
];

/**
 * OrganizationUserRoleField
 * Single Responsibility: Render a dropdown to change a user's organization role (Admin/Member)
 */
export function OrganizationUserRoleField({
  organizationId,
  userId,
  defaultRole,
}: {
  organizationId: string;
  userId: string;
  defaultRole: OrganizationUserRole;
}) {
  const updateOrganizationMemberRoleMutation =
    api.organization.updateMemberRole.useMutation();

  // Local state for optimistic updates
  const [selectedRole, setSelectedRole] = useState<OrgRoleOption>(
    () =>
      orgRoleOptions.find((o) => o.value === defaultRole) ?? orgRoleOptions[0]!,
  );

  return (
    <VStack align="start">
      <HStack gap={6}>
        <MultiSelect
          options={orgRoleOptions}
          value={selectedRole}
          isSearchable={false}
          chakraStyles={{
            container: (base) => ({
              ...base,
              minWidth: "200px",
            }),
          }}
          onChange={(value) => {
            const next = (value as OrgRoleOption | null)?.value;
            if (!next || next === selectedRole.value) return;

            // Optimistic update - immediately update UI
            const nextOption = orgRoleOptions.find((o) => o.value === next);
            if (nextOption) {
              setSelectedRole(nextOption);
            }

            updateOrganizationMemberRoleMutation.mutate(
              { organizationId, userId, role: next },
              {
                onSuccess: () => {
                  toaster.create({
                    title: "Organization role updated",
                    description: `Role changed to ${
                      orgRoleOptions.find((o) => o.value === next)?.label ??
                      next
                    }`,
                    type: "success",
                    duration: 3000,
                  });
                },
                onError: (error) => {
                  // Revert optimistic update on error
                  setSelectedRole(
                    orgRoleOptions.find((o) => o.value === defaultRole) ??
                      orgRoleOptions[0]!,
                  );
                  toaster.create({
                    title: "Error updating role",
                    description: error.message ?? "Please try again",
                    type: "error",
                  });
                },
              },
            );
          }}
          components={{
            Menu: ({ children, ...props }) => (
              <chakraComponents.Menu
                {...props}
                innerProps={{
                  ...props.innerProps,
                  style: { width: "320px", zIndex: 10 },
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
                    {props.data.description}
                  </Text>
                </VStack>
              </chakraComponents.Option>
            ),
          }}
        />
        {updateOrganizationMemberRoleMutation.isLoading && (
          <Spinner size="sm" />
        )}
      </HStack>
    </VStack>
  );
}
