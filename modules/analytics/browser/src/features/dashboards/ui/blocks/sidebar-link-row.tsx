/** A plain link row in a sidebar list, with no menu and no star: "All pinned (N)", a star. */

import { Box, Link as ChakraLink, Text } from "@langwatch/design-system/primitives";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-link.tsx";

export function SidebarLinkRow({ name, href }: { name: string; href: string }) {
  const host = useAnalyticsHost();
  return (
    <Box as="li" listStyleType="none" width="full">
      <ChakraLink
        href={href}
        display="flex"
        alignItems="center"
        gap={2}
        width="full"
        borderRadius="lg"
        paddingX={2}
        paddingY="4px"
        textStyle="bodySm"
        color="fg.subtle"
        textDecoration="none"
        _hover={{ color: "fg", background: "border/50" }}
        onClick={(event) => {
          if (opensElsewhere(event)) return;
          event.preventDefault();
          host.navigate(href);
        }}
      >
        <Text as="span" truncate minWidth={0}>
          {name}
        </Text>
      </ChakraLink>
    </Box>
  );
}
