import { Box, Flex, Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

/** A rail card: a quiet titled header over a bordered panel. */
export function Panel({
  title,
  aside,
  children,
  id,
  showHeader = true,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
  showHeader?: boolean;
}) {
  return (
    <Box
      as="section"
      id={id}
      aria-label={title}
      borderWidth="1px"
      borderColor="border"
      borderRadius="showcase"
      bg="bg.panel"
      overflow="hidden"
      minWidth="0"
      css={{ containerType: "inline-size" }}
    >
      {showHeader ? (
        <Flex
          bg="bg.subtle"
          alignItems="center"
          justifyContent="space-between"
          gap="3"
          minHeight="44px"
          paddingX="4"
          borderBottomWidth="1px"
          borderColor="border"
        >
          <Text as="h2" margin="0" fontSize="14px" lineHeight="16px" fontWeight="600" color="fg">
            {title}
          </Text>
          {aside}
        </Flex>
      ) : null}
      {children}
    </Box>
  );
}
