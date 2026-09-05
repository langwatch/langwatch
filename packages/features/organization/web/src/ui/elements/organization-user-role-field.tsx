import { createListCollection, HStack, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import { OrganizationUserRole } from "../../model/prisma-types";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { InfoWithoutSelecting } from "@langwatch/design-system/info-without-selecting";
import { Select } from "@langwatch/design-system/select";
import { CORE_SEAT_TYPE_COPY, useUiSeatTypeCopy } from "@langwatch/ui-host/slots";

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
    description: CORE_SEAT_TYPE_COPY.liteMemberShortDescription,
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
  // The composition may know better words for a lite seat than core's own.
  const seatCopy = useUiSeatTypeCopy();
  const roleOptions = useMemo(
    () =>
      orgRoleOptions.map((option) =>
        option.value === OrganizationUserRole.EXTERNAL
          ? { ...option, description: seatCopy.liteMemberShortDescription }
          : option,
      ),
    [seatCopy],
  );
  const roleCollection = useMemo(() => createListCollection({ items: roleOptions }), [roleOptions]);

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
            {roleOptions.map((option) => (
              <Select.Item key={option.value} item={option}>
                <VStack align="start" gap={0} flex={1}>
                  <HStack gap={0}>
                    <Text>{option.label}</Text>
                    {option.value === OrganizationUserRole.EXTERNAL && (
                      <InfoWithoutSelecting>
                        <FieldInfoTooltip
                          description={seatCopy.liteMemberExplanation}
                          docHref={seatCopy.seatTypesDocPath}
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
