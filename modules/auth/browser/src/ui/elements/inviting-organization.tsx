import { Avatar } from "@langwatch/design-system/avatar";
import { HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { getColorForString } from "@langwatch/design-system/rotating-colors";

import { SHAPE } from "../../model/front-door-theme.ts";

/** Who is asking: the organization's mark and name, and who sent the invitation when known. */
export function InvitingOrganization({
  organizationName,
  inviterName,
  testId,
}: {
  organizationName: string;
  inviterName: string | null;
  testId?: string;
}) {
  return (
    <HStack
      gap={3}
      padding="12px"
      borderWidth="1px"
      borderColor="frontDoor.fieldBorder"
      borderRadius={SHAPE.field}
      backgroundColor="frontDoor.fieldBg"
      data-testid={testId}
    >
      <Avatar.Root
        size="md"
        shape="rounded"
        color="white"
        background={getColorForString("colors", organizationName).color}
        flexShrink={0}
      >
        <Avatar.Fallback name={organizationName} />
      </Avatar.Root>
      <VStack align="start" gap={0} minWidth={0}>
        <Text fontSize="14px" fontWeight={600} lineHeight="1.4" overflowWrap="anywhere">
          {organizationName}
        </Text>
        <Text fontSize="13px" color="fg.muted" lineHeight="1.4">
          {inviterName ? (
            <>
              Invited by{" "}
              <Text as="strong" fontWeight={500} color="fg">
                {inviterName}
              </Text>
            </>
          ) : (
            "Join this organization on LangWatch"
          )}
        </Text>
      </VStack>
    </HStack>
  );
}
