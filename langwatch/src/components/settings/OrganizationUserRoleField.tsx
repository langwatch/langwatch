import { createListCollection, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { OrganizationUserRole } from "@prisma/client";
import { useMemo, useState } from "react";
import { api } from "../../utils/api";
import { Select } from "../ui/select";
import { toaster } from "../ui/toaster";

export type OrgRoleOption = {
  label: string;
  value: OrganizationUserRole;
  description: string;
};

export const orgRoleOptions: OrgRoleOption[] = [
  {
    label: "Admin",
    value: OrganizationUserRole.ADMIN,
    description: "Can manage organization and add or remove members",
  },
  {
    label: "Member",
    value: OrganizationUserRole.MEMBER,
    description: "Can manage their own projects and view other projects",
  },
  {
    label: "Lite Member",
    value: OrganizationUserRole.EXTERNAL,
    description: "Can only view projects they are invited to, cannot see costs",
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

  const roleCollection = useMemo(
    () => createListCollection({ items: orgRoleOptions }),
    [],
  );

  const handleRoleChange = (nextValue: string) => {
    const next = nextValue as OrganizationUserRole;
    if (next === selectedRole.value) return;

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
              orgRoleOptions.find((o) => o.value === next)?.label ?? next
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
  };

  return (
    <VStack align="start">
      <HStack gap={6}>
        <Select.Root
          collection={roleCollection}
          value={[selectedRole.value]}
          onValueChange={(details) => {
            const selectedValue = details.value[0];
            if (selectedValue) {
              handleRoleChange(selectedValue);
            }
          }}
        >
          <Select.Trigger width="200px">
            <Select.ValueText placeholder="Select role" />
          </Select.Trigger>
          <Select.Content width="320px" paddingY={2}>
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
        {updateOrganizationMemberRoleMutation.isLoading && (
          <Spinner size="sm" />
        )}
      </HStack>
    </VStack>
  );
}
