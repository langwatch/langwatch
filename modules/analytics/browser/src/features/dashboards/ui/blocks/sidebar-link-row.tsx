/** A plain link row in a sidebar list, with no menu and no star: "All pinned (N)", a star. */

import { Box, Link as ChakraLink, Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-link.tsx";

export function SidebarLinkRow({
  name,
  href,
  icon,
}: {
  name: string;
  href: string;
  /** Drawn before the name, as navigation's own entries draw theirs. */
  icon?: ReactNode;
}) {
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
        {icon && (
          <Box as="span" display="flex" flexShrink={0} aria-hidden>
            {icon}
          </Box>
        )}
        <Text as="span" truncate minWidth={0}>
          {name}
        </Text>
      </ChakraLink>
    </Box>
  );
}
