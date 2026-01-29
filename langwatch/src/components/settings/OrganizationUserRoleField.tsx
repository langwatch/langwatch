"use client";

import {
  HStack,
  Portal,
  Select,
  Span,
  Spinner,
  Stack,
  VStack,
  createListCollection,
} from "@chakra-ui/react";
import { OrganizationUserRole } from "@prisma/client";
import { useState } from "react";
import { api } from "../../utils/api";
import { toaster } from "../ui/toaster";

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

  const collection = createListCollection({
    items: orgRoleOptions,
  });

  return (
    <VStack align="start">
      <HStack gap={6}>
        <Select.Root
          collection={collection}
          size="sm"
          width="220px"
          value={[selectedRole.value]}
          onValueChange={({ value }) => {
            const next = value[0] as OrganizationUserRole;
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
          positioning={{ sameWidth: false }}
        >
          <Select.HiddenSelect />
          <Select.Control>
            <Select.Trigger>
              <Select.ValueText placeholder="Select role" />
            </Select.Trigger>
            <Select.IndicatorGroup>
              <Select.Indicator />
            </Select.IndicatorGroup>
          </Select.Control>
          <Portal>
            <Select.Positioner>
              <Select.Content minWidth="320px" paddingY={1}>
                {orgRoleOptions.map((role) => (
                  <Select.Item item={role} key={role.value} paddingY={2.5}>
                    <Stack gap="0.5" maxWidth="280px">
                      <Select.ItemText fontWeight="500" wordBreak="break-word">
                        {role.label}
                      </Select.ItemText>
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
        {updateOrganizationMemberRoleMutation.isPending && (
          <Spinner size="sm" />
        )}
      </HStack>
    </VStack>
  );
}
