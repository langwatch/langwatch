import { Box, Button } from "@langwatch/design-system/primitives";
import { useId } from "react";
import type { ReactNode } from "react";

export function Tooltip({
  tip,
  children,
}: {
  tip?: string;
  headline?: string;
  cta?: string;
  href?: string;
  children?: ReactNode;
}) {
  const id = useId();
  if (!tip) return <>{children}</>;
  return (
    <Box as="span" position="relative" display="inline-block">
      <Button
        data-docs-tooltip=""
        aria-describedby={id}
        type="button"
        variant="plain"
        size="xs"
        display="inline"
        height="auto"
        minWidth="0"
        padding="0"
        font="inherit"
        color="inherit"
        textDecoration="underline dotted"
        textUnderlineOffset="3px"
      >
        {children}
      </Button>
      <Box
        id={id}
        role="tooltip"
        hidden
        data-docs-tooltip-content=""
        position="absolute"
        top="100%"
        insetInlineStart="0"
        zIndex="popover"
        width="280px"
        maxWidth="calc(100vw - 2rem)"
        padding="3"
        fontSize="14px"
        lineHeight="22px"
        bg="docs.raised"
        color="fg"
        borderWidth="1px"
        borderColor="border"
        borderRadius="lg"
        boxShadow="0 8px 24px var(--chakra-colors-docs-shadow-strong)"
      >
        {tip}
      </Box>
    </Box>
  );
}
