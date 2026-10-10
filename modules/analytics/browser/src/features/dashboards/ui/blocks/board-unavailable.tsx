/**
 * The page for a board the reader may not open: deleted, or set to Only me by its author. It
 * says the same for both and shows no part of the board, as the server answers the same for both.
 * @see modules/dashboard/specs/dashboards-v2.feature AC183
 */

import { Heading, Text, VStack } from "@langwatch/design-system/primitives";
import { Lock } from "lucide-react";

import { BOARD_UNAVAILABLE } from "../../model/board-scope.ts";

export function BoardUnavailable() {
  return (
    <VStack gap={3} paddingY={20} paddingX={6} textAlign="center" color="fg.muted">
      <Lock size={22} aria-hidden />
      <Heading as="h1" fontSize="19px" fontWeight="semibold" color="fg">
        {BOARD_UNAVAILABLE.title}
      </Heading>
      <Text fontSize="13px" maxWidth="md">
        {BOARD_UNAVAILABLE.body}
      </Text>
    </VStack>
  );
}
