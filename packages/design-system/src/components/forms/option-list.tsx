import { Box, Text, chakra } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { optionItemRecipe } from "../../system/option-list.recipe.ts";

export const OptionItem = chakra("button", optionItemRecipe);

/** Pair with a disabled picker only after its unfiltered options have loaded empty. */
export function EmptyOptionsHint({
  id,
  children,
  action,
}: {
  id?: string;
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <Box
      id={id}
      width="full"
      paddingX={3}
      paddingY={2}
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="md"
      background="bg.subtle"
    >
      <Text fontSize="sm" color="fg.muted">
        {children}
      </Text>
      <Box fontSize="sm" marginTop={1}>
        {action}
      </Box>
    </Box>
  );
}
