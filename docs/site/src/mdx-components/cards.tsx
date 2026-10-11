import { Box, Flex, Link, Text } from "@langwatch/design-system/primitives";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Children, isValidElement } from "react";
import type { ReactNode } from "react";
import { DocsLink } from "./link.tsx";
import { Icon } from "./icon.tsx";

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

const STRETCH = { "&::after": { content: '""', position: "absolute", inset: "0", borderRadius: "showcase" } } as const;

/** An outlined card; with authored links inside, only the title navigates. */
export function Card({ title, description, icon, href, horizontal, arrow, children }: CardProps) {
  const external = Boolean(href && /^https?:/.test(href));
  const stretch = Boolean(href) && !containsLink({ node: children });
  const showArrow = arrow === true || arrow === "true";
  const heading = (
    <Flex alignItems="center" gap="1" fontSize="16px" lineHeight="24px" fontWeight="600" color="fg">
      <span>{title}</span>
      {href && showArrow ? (external ? <ArrowUpRight size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />) : null}
    </Flex>
  );
  return (
    <Box
      position="relative"
      display="flex"
      flexDirection={horizontal ? "row" : "column"}
      alignItems={horizontal ? "flex-start" : "stretch"}
      gap="3"
      padding="5"
      borderWidth="1px"
      borderColor="border"
      borderRadius="showcase"
      bg="bg.panel"
      minWidth="0"
      css={href ? { "&:hover": { borderColor: "border.emphasized" } } : undefined}
    >
      {icon ? (
        <Flex alignItems="center" justifyContent="center" flexShrink={0} width="2rem" height="2rem" borderRadius="lg" bg="bg.subtle">
          <Icon icon={icon} size={20} />
        </Flex>
      ) : null}
      <Flex direction="column" gap="1" minWidth="0" flex="1">
        {title ? (
          href ? (
            <Link href={href} color="fg" textDecoration="none" _hover={{ textDecoration: "none" }} css={stretch ? STRETCH : undefined}>
              {heading}
            </Link>
          ) : (
            heading
          )
        ) : null}
        {description ? (
          <Text fontSize="14px" lineHeight="24px" color="fg.muted" margin="0">
            {description}
          </Text>
        ) : null}
        {children ? (
          <Box className="docs-card-body" fontSize="14px" lineHeight="24px" color="fg.muted" minWidth="0">
            {children}
          </Box>
        ) : null}
      </Flex>
    </Box>
  );
}

/** Columns follow the group's own width: one, then two from 480px, three from 840px. */
export function CardGroup({ cols = 2, children }: { cols?: number | string; children?: ReactNode }) {
  const max = Number(cols) || 2;
  return (
    <Box marginY="6" css={{ containerType: "inline-size" }}>
      <Box
        display="grid"
        gap="4"
        css={{
          gridTemplateColumns: "minmax(0, 1fr)",
          "@container (min-width: 480px)": { gridTemplateColumns: max > 1 ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)" },
          "@container (min-width: 840px)": { gridTemplateColumns: `repeat(${Math.min(Math.max(max, 1), 3)}, minmax(0, 1fr))` },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
