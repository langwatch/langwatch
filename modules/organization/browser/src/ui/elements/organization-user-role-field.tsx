import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { InfoWithoutSelecting } from "@langwatch/design-system/info-without-selecting";
import { createListCollection, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import { useMemo } from "react";

import { OrganizationUserRole } from "../../model/prisma-types.ts";
import { SEAT_TYPE_COPY } from "../../model/seat-type-copy.ts";

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
    description: SEAT_TYPE_COPY.liteMemberShortDescription,
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
  const roleCollection = useMemo(() => createListCollection({ items: orgRoleOptions }), []);

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
          <Select.Trigger width="200px" data-testid="members-role-select">
            <Select.ValueText placeholder="Select role" />
          </Select.Trigger>
          <Select.Content width="320px" paddingY={2}>
            {orgRoleOptions.map((option) => (
              <Select.Item
                key={option.value}
                item={option}
                data-testid={`members-role-option-${option.value}`}
              >
                <VStack align="start" gap={0} flex={1}>
                  <HStack gap={0}>
                    <Text>{option.label}</Text>
                    {option.value === OrganizationUserRole.EXTERNAL && (
                      <InfoWithoutSelecting>
                        <FieldInfoTooltip
                          description={SEAT_TYPE_COPY.liteMemberExplanation}
                          docHref={SEAT_TYPE_COPY.seatTypesDocPath}
                          docLabel="How seats are counted"
                          testId="lite-member-info"
                        />
                      </InfoWithoutSelecting>
                    )}
                  </HStack>
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
