import { Box } from "@langwatch/design-system/primitives";
import type { SystemStyleObject } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import { Icon } from "./icon.tsx";

const STEPS_CSS = {
  listStyle: "none",
  margin: "0",
  padding: "0",
  counterReset: "docs-step",
  "& > li": {
    position: "relative",
    counterIncrement: "docs-step",
    paddingInlineStart: "11",
    paddingBottom: "8",
    margin: "0",
    "&::before": {
      content: "counter(docs-step)",
      position: "absolute",
      insetInlineStart: "0",
      top: "0",
      width: "28px",
      height: "28px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "full",
      bg: "accent.solid",
      color: "docs.primaryText",
      boxShadow:
        "0 0 0 4px var(--chakra-colors-accent-subtle), 0 2px 6px color-mix(in srgb, var(--chakra-colors-accent-solid) 35%, transparent)",
      fontFamily: "body",
      fontSize: "14px",
      lineHeight: "20px",
      fontWeight: "700",
      fontVariantNumeric: "tabular-nums",
    },
    "&:not(:last-of-type)::after": {
      content: '""',
      position: "absolute",
      insetInlineStart: "13px",
      top: "40px",
      bottom: "8px",
      width: "2px",
      borderRadius: "full",
      background:
        "linear-gradient(to bottom, color-mix(in srgb, var(--chakra-colors-accent-solid) 55%, transparent), var(--chakra-colors-border) 85%)",
    },
    "&:last-of-type": { paddingBottom: "0" },
  },
} satisfies SystemStyleObject;

export function Steps({ children }: { children?: ReactNode }) {
  return (
    <Box as="ol" className="docs-steps" marginY="6" css={STEPS_CSS}>
      {children}
    </Box>
  );
}

export function Step({
  title,
  icon,
  id,
  children,
}: {
  title?: string;
  icon?: string;
  id?: string;
  children?: ReactNode;
}) {
  return (
    <li>
      {title ? (
        <Box
          as="h3"
          color="fg"
          id={id}
          display="flex"
          alignItems="center"
          gap="2"
          margin="0"
          marginBottom="3"
          paddingTop="0"
          fontSize="17px"
          lineHeight="28px"
          fontWeight="600"
          fontFamily="var(--docs-font-heading)"
        >
          {icon ? <Icon icon={icon} size={18} /> : null}
          {title}
        </Box>
      ) : null}
      <Box className="docs-step-body" minWidth="0">
        {children}
      </Box>
    </li>
  );
}
