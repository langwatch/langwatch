// One of the three predefined roles: holders, the permissions it headlines, and a way in.

import { Box, Button, Card, HStack, Spacer, Text, VStack } from "@chakra-ui/react";

import type { BuiltinRoleCard } from "../../model/builtin-roles.ts";
import { actionOf, resourceOf } from "../../model/permission-catalogue.ts";

const TIER_COLOUR = { ADMIN: "red", MEMBER: "blue", VIEWER: "gray" } as const;

/** A permission as the engine spells it, the resource in front and the action quieter. */
function PermissionChip({ permission }: { permission: string }) {
  return (
    <Box
      as="span"
      paddingX={1.5}
      paddingY={0.5}
      borderRadius="md"
      borderWidth="1px"
      borderColor="border.muted"
      background="bg.subtle"
      fontFamily="mono"
      fontSize="xs"
      whiteSpace="nowrap"
      data-testid="permission-token"
    >
      <Text as="span">{resourceOf(permission)}</Text>
      <Text as="span" color="fg.subtle">
        :{actionOf(permission)}
      </Text>
    </Box>
  );
}

export function BuiltinRoleCardView({
  card,
  people,
  totalPermissions,
  onOpenDetail,
}: {
  card: BuiltinRoleCard;
  /** How many people hold it, or null while that is still being read. */
  people: number | null;
  totalPermissions: number;
  onOpenDetail: () => void;
}) {
  return (
    <Card.Root
      width="full"
      height="full"
      variant="outline"
      borderColor="border.muted"
      colorPalette={TIER_COLOUR[card.teamRole]}
      data-testid={`builtin-role-${card.teamRole.toLowerCase()}`}
    >
      <Card.Body display="flex" flexDirection="column" gap={2.5} padding={4}>
        <HStack width="full" align="baseline" gap={2}>
          <Box
            width="7px"
            height="7px"
            borderRadius="full"
            backgroundColor="colorPalette.solid"
            alignSelf="center"
            flexShrink={0}
          />
          <Text fontWeight="semibold" fontSize="sm">
            {card.name}
          </Text>
          <Spacer />
          <Text fontSize="xs" color="fg.muted">
            {people === null
              ? "Holders unavailable"
              : `${people} ${people === 1 ? "person" : "people"}`}
          </Text>
        </HStack>

        <Text fontSize="xs" color="fg.muted" lineHeight="1.5">
          {card.description}
        </Text>

        <Spacer />

        <VStack
          align="start"
          gap={2}
          width="full"
          borderTopWidth="1px"
          borderColor="border.muted"
          paddingTop={2.5}
        >
          <Text fontSize="xs" color="fg.subtle" textTransform="uppercase" letterSpacing="wider">
            {card.inheritsFrom
              ? `Everything ${card.inheritsFrom} has, and`
              : "The base every other role builds on"}
          </Text>
          <HStack wrap="wrap" gap={1.5}>
            {card.headline.map((permission) => (
              <PermissionChip key={permission} permission={permission} />
            ))}
          </HStack>
          <Text fontSize="xs" color="fg.subtle">
            {totalPermissions} permissions in total
          </Text>
        </VStack>

        <Button size="xs" variant="ghost" color="fg.muted" alignSelf="start" onClick={onOpenDetail}>
          See what it can do
        </Button>
      </Card.Body>
    </Card.Root>
  );
}
