import { Box, Link } from "@langwatch/design-system/primitives";
import { Link2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { TypeRegion } from "../../../lib/type-mode.tsx";

/** A heading with a hover and focus anchor; a body H1 is presented as H2 and keeps its id. */
export function makeHeading({ level }: { level: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const tags = { 1: "h2", 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } satisfies Record<
    number,
    "h2" | "h3" | "h4" | "h5" | "h6"
  >;
  const tag = tags[level];
  return function DocsHeading({ id, children }: { id?: string; children?: ReactNode }) {
    return (
      <Box as={tag} id={id} className="docs-heading" data-level={Math.max(level, 2)}>
        {children}
        {id ? (
          <a className="docs-anchor" href={`#${id}`} aria-label="Link to this section">
            <Link2 size={16} aria-hidden="true" />
          </a>
        ) : null}
      </Box>
    );
  };
}

export function DocsInlineCode({ children }: { children?: ReactNode }) {
  return (
    <Box
      as="code"
      bg="bg.control"
      color="fg"
      fontFamily="mono"
      fontSize="0.875em"
      lineHeight="1.7"
      paddingX="1"
      paddingY="1px"
      borderRadius="xs"
      overflowWrap="anywhere"
      wordBreak="break-word"
    >
      {children}
    </Box>
  );
}

export function DocsTable(props: ComponentProps<"table">) {
  return (
    <TypeRegion
      mode="productive"
      className="docs-table-scroll"
      as="section"
      tabIndex={0}
      aria-label="Table"
      overflowX="auto"
      marginY="6"
    >
      <table {...props} />
    </TypeRegion>
  );
}

/** Prose links use ink with an orange underline; the label remains legible without colour. */
export function DocsLink({ href, children, ...rest }: ComponentProps<typeof Link>) {
  return (
    <Link
      href={href}
      color="fg"
      fontWeight="500"
      textDecorationColor="accent.fg"
      textDecoration="underline"
      textUnderlineOffset="2px"
      _hover={{ textDecoration: "underline" }}
      {...rest}
    >
      {children}
    </Link>
  );
}
