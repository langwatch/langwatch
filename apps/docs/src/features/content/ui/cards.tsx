import type { SystemStyleObject } from "@langwatch/design-system/primitives";
import { Box, Flex, Link, Text } from "@langwatch/design-system/primitives";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Children, isValidElement } from "react";
import type { ReactNode } from "react";

import { Icon } from "./icon.tsx";
import { DocsLink } from "./prose.tsx";

function containsLink({ node }: { node: ReactNode }): boolean {
  return Children.toArray(node).some((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return false;
    if (child.type === DocsLink || child.type === "a") return true;
    return containsLink({ node: child.props.children });
  });
}

type CardProps = {
  title?: string;
  description?: string;
  icon?: string;
  href?: string;
  horizontal?: boolean;
  arrow?: boolean | string;
  children?: ReactNode;
};

const STRETCH = {
  "&::after": { content: '""', position: "absolute", inset: "0", borderRadius: "sm" },
  "&:focus-visible": { outline: "none" },
  "&:focus-visible::after": {
    outline: "2px solid",
    outlineColor: "blue.focusRing",
    outlineOffset: "2px",
  },
} satisfies SystemStyleObject;

function CardHeading({
  title,
  href,
  external,
  showArrow,
}: {
  title?: string;
  href?: string;
  external: boolean;
  showArrow: boolean;
}) {
  const Direction = external ? ArrowUpRight : ArrowRight;
  return (
    <Flex alignItems="center" gap="1" fontSize="16px" lineHeight="24px" fontWeight="600" color="fg">
      <span>{title}</span>
      {href && showArrow ? <Direction size={16} aria-hidden="true" /> : null}
    </Flex>
  );
}

/** A linked reading row; authored links inside keep their own targets. */
export function Card({
  title,
  description,
  icon,
  href,
  horizontal: _horizontal,
  arrow,
  children,
}: CardProps) {
  const external = Boolean(href && /^https?:/.test(href));
  const stretch = Boolean(href) && !containsLink({ node: children });
  const compact = Boolean(icon && !description && !Children.toArray(children).length);
  const showArrow = Boolean(href) && arrow !== false && arrow !== "false";
  const heading = (
    <CardHeading title={title} href={href} external={external} showArrow={showArrow} />
  );
  return (
    <Box
      className="docs-card"
      data-compact={compact}
      position="relative"
      display="flex"
      flexDirection="row"
      alignItems={compact ? "center" : "flex-start"}
      gap="4"
      paddingY="4"
      paddingX="2"
      minHeight={compact ? "64px" : void 0}
      borderTopWidth="1px"
      borderColor="border"
      borderRadius="sm"
      bg="transparent"
      minWidth="0"
    >
      {icon ? (
        <Flex
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
          width="2.25rem"
          height="2.25rem"
          borderRadius="lg"
          bg="transparent"
          color="accent.fg"
        >
          <Icon icon={icon} size={compact ? 24 : 20} />
        </Flex>
      ) : null}
      <Flex direction="column" gap="2" minWidth="0" flex="1">
        {title && href ? (
          <Link
            href={href}
            color="fg"
            textDecoration="none"
            _hover={{ textDecoration: "none" }}
            css={stretch ? STRETCH : void 0}
          >
            {heading}
          </Link>
        ) : null}
        {title && !href ? heading : null}
        {description ? (
          <Text fontSize="14px" lineHeight="24px" color="fg.muted" margin="0">
            {description}
          </Text>
        ) : null}
        {children ? (
          <Box
            className="docs-card-body"
            fontSize="14px"
            lineHeight="24px"
            color="fg.muted"
            minWidth="0"
          >
            {children}
          </Box>
        ) : null}
      </Flex>
    </Box>
  );
}

/** Columns follow the group's own width: one, then two from 480px, three from 840px. */
export function CardGroup({
  cols = 2,
  children,
}: {
  cols?: number | string;
  children?: ReactNode;
}) {
  const max = Number(cols) || 2;
  return (
    <Box marginY="6" css={{ containerType: "inline-size" }}>
      <Box
        className="docs-card-grid"
        display="grid"
        alignItems="stretch"
        columnGap="8"
        rowGap="0"
        css={{
          gridTemplateColumns: "minmax(0, 1fr)",
          "@container (min-width: 480px)": {
            gridTemplateColumns: max > 1 ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)",
          },
          "@container (min-width: 840px)": {
            gridTemplateColumns: `repeat(${Math.min(Math.max(max, 1), 3)}, minmax(0, 1fr))`,
          },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
