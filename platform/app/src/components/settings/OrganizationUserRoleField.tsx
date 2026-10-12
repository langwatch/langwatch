import { createListCollection, HStack, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import { OrganizationUserRole } from "~/generated/prisma/client";
import { FieldInfoTooltip } from "../ui/FieldInfoTooltip";
import { Select } from "../ui/select";
import { InfoWithoutSelecting } from "./InfoWithoutSelecting";
import {
  DEVELOPER_EXPLANATION,
  DEVELOPER_SHORT_DESCRIPTION,
  LITE_MEMBER_EXPLANATION,
  LITE_MEMBER_SHORT_DESCRIPTION,
  SEAT_TYPES_DOC_PATH,
} from "./seatTypeCopy";

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
    description: LITE_MEMBER_SHORT_DESCRIPTION,
  },
  {
    label: "Developer",
    value: OrganizationUserRole.DEVELOPER,
    description: DEVELOPER_SHORT_DESCRIPTION,
  },
];

/** The seats whose boundary is explained behind the (i) in the picker. */
const SEAT_EXPLANATIONS: Partial<
  Record<OrganizationUserRole, { description: string; testId: string }>
> = {
  [OrganizationUserRole.EXTERNAL]: {
    description: LITE_MEMBER_EXPLANATION,
    testId: "lite-member-info",
  },
  [OrganizationUserRole.DEVELOPER]: {
    description: DEVELOPER_EXPLANATION,
    testId: "developer-info",
  },
};

/**
 * OrganizationUserRoleField
 * Single Responsibility: Render a dropdown to choose a user's organization role
 *
 * The same picker serves the members drawer and the invite form, so both
 * surfaces explain the seats in the same words. `roles` narrows the list where
 * a surface offers fewer seats: the invite form hands out no Admin seat.
 */
export function OrganizationUserRoleField({
  value,
  onChange,
  roles,
  width = "200px",
  ariaLabel = "Organization role",
}: {
  value: OrganizationUserRole;
  onChange: (role: OrganizationUserRole) => void;
  roles?: readonly OrganizationUserRole[];
  width?: string;
  ariaLabel?: string;
}) {
  const options = useMemo(
    () =>
      roles
        ? orgRoleOptions.filter((option) => roles.includes(option.value))
        : orgRoleOptions,
    [roles],
  );
  const roleCollection = useMemo(
    () => createListCollection({ items: options }),
    [options],
  );
  // A full-width trigger gets a menu the same width, so it never runs past
  // the edge of whatever holds the field; a narrow trigger gets a menu wide
  // enough for the descriptions to read in one or two lines.
  const isFullWidth = width === "full";

  return (
    <VStack align="start" width="full">
      <HStack gap={6} width="full">
        <Select.Root
          collection={roleCollection}
          value={[value]}
          onValueChange={(details) => {
            const selectedValue = details.value[0];
            if (selectedValue) {
              onChange(selectedValue as OrganizationUserRole);
            }
          }}
          positioning={{ sameWidth: isFullWidth }}
        >
          <Select.Trigger width={width} aria-label={ariaLabel} background="bg">
            <Select.ValueText placeholder="Select role" />
          </Select.Trigger>
          <Select.Content
            width={isFullWidth ? undefined : "320px"}
            paddingY={2}
          >
            {options.map((option) => (
              <Select.Item key={option.value} item={option}>
                <VStack align="start" gap={0} flex={1}>
                  <HStack gap={0}>
                    <Text>{option.label}</Text>
                    {SEAT_EXPLANATIONS[option.value] && (
                      <InfoWithoutSelecting>
                        <FieldInfoTooltip
                          description={
                            SEAT_EXPLANATIONS[option.value]!.description
                          }
                          docHref={SEAT_TYPES_DOC_PATH}
                          docLabel="How seats are counted"
                          testId={SEAT_EXPLANATIONS[option.value]!.testId}
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
