import { Box } from "@langwatch/design-system/primitives";
import { Link2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { TypeRegion } from "../lib/type-mode.tsx";

/** A heading with a hover and focus anchor; a body H1 is presented as H2 and keeps its id. */
export function makeHeading({ level }: { level: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const tag = `h${Math.max(level, 2)}` as "h2";
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
      role="region"
      tabIndex={0}
      aria-label="Table"
      overflowX="auto"
      marginY="6"
    >
      <table {...props} />
    </TypeRegion>
  );
}
