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
  {
    label: "Developer",
    value: OrganizationUserRole.DEVELOPER,
    description: SEAT_TYPE_COPY.developerShortDescription,
  },
];

/** The seats whose boundary is explained behind the (i) in the picker. */
const SEAT_EXPLANATIONS: Partial<
  Record<OrganizationUserRole, { description: string; testId: string }>
> = {
  [OrganizationUserRole.EXTERNAL]: {
    description: SEAT_TYPE_COPY.liteMemberExplanation,
    testId: "lite-member-info",
  },
  [OrganizationUserRole.DEVELOPER]: {
    description: SEAT_TYPE_COPY.developerExplanation,
    testId: "developer-info",
  },
};

function SeatExplanationInfo({ role }: { role: OrganizationUserRole }) {
  const explanation = SEAT_EXPLANATIONS[role];
  if (!explanation) return null;
  return (
    <InfoWithoutSelecting>
      <FieldInfoTooltip
        description={explanation.description}
        docHref={SEAT_TYPE_COPY.seatTypesDocPath}
        docLabel="How seats are counted"
        testId={explanation.testId}
      />
    </InfoWithoutSelecting>
  );
}

/**
 * Dropdown to choose a user's organization role, shared by the members drawer and the invite form.
 * `roles` narrows the list where a surface offers fewer seats: invites hand out no Admin seat.
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
      roles ? orgRoleOptions.filter((option) => roles.includes(option.value)) : orgRoleOptions,
    [roles],
  );
  const roleCollection = useMemo(() => createListCollection({ items: options }), [options]);
  // A full-width trigger gets a menu the same width, so it never runs past the edge of
  // whatever holds the field; a narrow trigger gets a menu wide enough for the descriptions.
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
          <Select.Trigger
            width={width}
            aria-label={ariaLabel}
            background="bg"
            data-testid="members-role-select"
          >
            <Select.ValueText placeholder="Select role" />
          </Select.Trigger>
          <Select.Content width={isFullWidth ? void 0 : "320px"} paddingY={2}>
            {options.map((option) => (
              <Select.Item
                key={option.value}
                item={option}
                data-testid={`members-role-option-${option.value}`}
              >
                <VStack align="start" gap={0} flex={1}>
                  <HStack gap={0}>
                    <Text>{option.label}</Text>
                    <SeatExplanationInfo role={option.value} />
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
