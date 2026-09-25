import { Badge, HStack, Text } from "@chakra-ui/react";

/** The address, whether it is primary, and whether it has been confirmed when that is known. */
export function AddressBadges({
  value,
  isPrimary,
  confirmed,
}: {
  value: string;
  isPrimary: boolean;
  confirmed: boolean | undefined;
}) {
  return (
    <HStack gap={2}>
      <Text fontSize="sm" fontWeight={500}>
        {value}
      </Text>
      {isPrimary ? (
        <Badge size="sm" variant="subtle">
          Primary
        </Badge>
      ) : null}
      {confirmed === true ? (
        <Badge size="sm" colorPalette="green" variant="subtle" data-testid="address-confirmed">
          Confirmed
        </Badge>
      ) : null}
      {confirmed === false ? (
        <Badge size="sm" colorPalette="orange" variant="subtle" data-testid="address-unconfirmed">
          Not confirmed yet
        </Badge>
      ) : null}
    </HStack>
  );
}
