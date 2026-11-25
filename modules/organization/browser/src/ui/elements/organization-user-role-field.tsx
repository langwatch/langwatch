import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { InfoWithoutSelecting } from "@langwatch/design-system/info-without-selecting";
import { createListCollection, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";

import { BILLING_ONLY_SEAT, type InviteSeat } from "../../model/member-invite-form.ts";
import { OrganizationUserRole } from "../../model/prisma-types.ts";
import { SEAT_TYPE_COPY } from "../../model/seat-type-copy.ts";

export type OrgRoleOption = {
  label: string;
  value: InviteSeat;
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
  {
    label: "Billing only",
    value: BILLING_ONLY_SEAT,
    description: SEAT_TYPE_COPY.billingOnlyShortDescription,
  },
];

/** The seat a member or invitation holds, in the picker's words; Billing only by its flag. */
export function seatLabel({
  role,
  billingOnly,
}: {
  role: OrganizationUserRole;
  billingOnly?: boolean;
}): string {
  const seat: InviteSeat = billingOnly ? BILLING_ONLY_SEAT : role;
  return orgRoleOptions.find((option) => option.value === seat)?.label ?? role;
}

/** The seats whose boundary is explained behind the (i) in the picker. */
const SEAT_EXPLANATIONS: Partial<Record<InviteSeat, { description: string; testId: string }>> = {
  [OrganizationUserRole.EXTERNAL]: {
    description: SEAT_TYPE_COPY.liteMemberExplanation,
    testId: "lite-member-info",
  },
  [OrganizationUserRole.DEVELOPER]: {
    description: SEAT_TYPE_COPY.developerExplanation,
    testId: "developer-info",
  },
  [BILLING_ONLY_SEAT]: {
    description: SEAT_TYPE_COPY.billingOnlyExplanation,
    testId: "billing-only-info",
  },
};

/**
 * Renders a dropdown to choose a user's organization role. The members drawer
 * and the invite form share it; `roles` narrows the list where a surface
 * offers fewer seats (the invite form hands out no Admin seat).
 */
export function OrganizationUserRoleField<Seat extends InviteSeat = OrganizationUserRole>({
  value,
  onChange,
  roles,
  width = "200px",
  ariaLabel = "Organization role",
}: {
  value: Seat;
  onChange: (role: Seat) => void;
  /** The choices offered; Billing only is an invite choice, offered only when listed. */
  roles?: readonly Seat[];
  width?: string;
  ariaLabel?: string;
}) {
  const offered: readonly InviteSeat[] =
    roles ??
    orgRoleOptions.map((option) => option.value).filter((seat) => seat !== BILLING_ONLY_SEAT);
  const options = orgRoleOptions.filter((option) => offered.includes(option.value));
  const roleCollection = createListCollection({ items: options });
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
              onChange(selectedValue as Seat);
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
          <Select.Content width={isFullWidth ? undefined : "320px"} paddingY={2}>
            {options.map((option) => (
              <Select.Item
                key={option.value}
                item={option}
                data-testid={`members-role-option-${option.value}`}
              >
                <VStack align="start" gap={0} flex={1}>
                  <HStack gap={0}>
                    <Text>{option.label}</Text>
                    {SEAT_EXPLANATIONS[option.value] && (
                      <InfoWithoutSelecting>
                        <FieldInfoTooltip
                          description={SEAT_EXPLANATIONS[option.value]?.description ?? ""}
                          docHref={SEAT_TYPE_COPY.seatTypesDocPath}
                          docLabel="How seats are counted"
                          testId={SEAT_EXPLANATIONS[option.value]?.testId}
                        />
                      </InfoWithoutSelecting>
                    )}
                  </HStack>
                  <Text textStyle="bodySm" color="fg.muted">
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
