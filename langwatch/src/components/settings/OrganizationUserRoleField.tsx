import { createListCollection, HStack, Text, VStack } from "@chakra-ui/react";
import { OrganizationUserRole } from "@prisma/client";
import { useMemo } from "react";
import { Select } from "../ui/select";

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
 * Single Responsibility: Render a dropdown to choose a user's organization role
 */
export function OrganizationUserRoleField({
  value,
  onChange,
}: {
  value: OrganizationUserRole;
  onChange: (role: OrganizationUserRole) => void;
}) {
  const roleCollection = useMemo(
    () => createListCollection({ items: orgRoleOptions }),
    [],
  );

  return (
    <VStack align="start">
      <HStack gap={6}>
        <Select.Root
          collection={roleCollection}
          value={[value]}
          onValueChange={(details) => {
            const selectedValue = details.value[0];
            if (selectedValue) {
              onChange(selectedValue as OrganizationUserRole);
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
      </HStack>
    </VStack>
  );
}
