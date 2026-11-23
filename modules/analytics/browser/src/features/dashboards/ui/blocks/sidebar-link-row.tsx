/** A plain link row in a sidebar list, with no menu and no star: a board or a star. */

import { Box, Link as ChakraLink, Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-link.tsx";

export function SidebarLinkRow({
  name,
  href,
  icon,
  iconTitle,
  isActive = false,
}: {
  name: string;
  href: string;
  /** Drawn before the name, as navigation's own entries draw theirs. */
  icon?: ReactNode;
  /** What the icon says on hover, such as who sees the board. */
  iconTitle?: string;
  /** The page the reader is on, marked as navigation marks its own entries. */
  isActive?: boolean;
}) {
  const host = useAnalyticsHost();
  return (
    <Box as="li" listStyleType="none" width="full">
      <ChakraLink
        href={href}
        aria-current={isActive ? "page" : void 0}
        display="flex"
        alignItems="center"
        gap={2}
        width="full"
        borderRadius="lg"
        paddingX={2}
        paddingY="4px"
        textStyle="bodySm"
        color={isActive ? "fg" : "fg.subtle"}
        fontWeight={isActive ? "medium" : void 0}
        background={isActive ? "border" : void 0}
        textDecoration="none"
        _hover={{ color: "fg", background: isActive ? "border" : "border/50" }}
        onClick={(event) => {
          if (opensElsewhere(event)) return;
          event.preventDefault();
          host.navigate(href);
        }}
      >
        {icon && (
          <Box as="span" display="flex" flexShrink={0} title={iconTitle} aria-hidden>
            {icon}
          </Box>
        )}
        {/* A long name is clipped with an ellipsis and read in full on hover. */}
        <Text as="span" truncate minWidth={0} title={name}>
          {name}
        </Text>
      </ChakraLink>
    </Box>
  );
}
