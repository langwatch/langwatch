import type { SystemStyleObject } from "@langwatch/design-system/primitives";
import { Box, Flex, Link, Text } from "@langwatch/design-system/primitives";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Children, isValidElement } from "react";
import type { ReactNode } from "react";

import { sitePath } from "../../../lib/site-path.ts";
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
  "&::after": { content: '""', position: "absolute", inset: "-1px", borderRadius: "2xl" },
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
    <Flex
      alignItems="center"
      gap="3"
      minWidth="0"
      width="100%"
      fontSize="16px"
      lineHeight="24px"
      fontWeight="600"
      color="fg"
    >
      <Text as="span" flex="1" minWidth="0">
        {title}
      </Text>
      {href && showArrow ? (
        <Flex
          as="span"
          className="docs-card-action"
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
          width="28px"
          height="28px"
          borderRadius="full"
          bg="accent.subtle"
          color="accent.fg"
        >
          <Direction className="docs-card-arrow" size={18} aria-hidden="true" />
        </Flex>
      ) : null}
    </Flex>
  );
}

/** An asset path is a third-party logo; it sits on a light chip so dark marks stay visible. */
function isLogo(icon: string) {
  return /^(\/|https?:)/.test(icon);
}

/** A bordered card at rest; a link adds a hover lift and accent edge, never the card itself. */
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
  const logo = Boolean(icon && isLogo(icon));
  const heading = (
    <CardHeading title={title} href={href} external={external} showArrow={showArrow} />
  );
  return (
    <Box
      className="docs-card"
      data-compact={compact}
      data-linked={Boolean(href) || void 0}
      position="relative"
      display="flex"
      flexDirection="row"
      alignItems={compact ? "center" : "flex-start"}
      gap={compact ? "3" : "4"}
      padding={compact ? "3" : "5"}
      minHeight={compact ? "64px" : void 0}
      borderWidth="1px"
      borderColor="border.emphasized"
      borderRadius="2xl"
      bg="docs.raised"
      minWidth="0"
    >
      {icon ? (
        <Flex
          className={logo ? "docs-card-logo" : "docs-card-icon"}
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
          width="2.5rem"
          height="2.5rem"
          borderRadius="lg"
          borderWidth="1px"
          color="accent.fg"
        >
          <Icon icon={icon} size={logo ? 24 : 20} />
        </Flex>
      ) : null}
      <Flex direction="column" gap="1.5" minWidth="0" flex="1">
        {title && href ? (
          <Link
            href={sitePath({ path: href })}
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
          <Text fontSize="14px" lineHeight="24px" color="docs.body" margin="0">
            {description}
          </Text>
        ) : null}
        {children ? (
          <Box
            className="docs-card-body"
            fontSize="14px"
            lineHeight="24px"
            color="docs.body"
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
        gap="3"
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
