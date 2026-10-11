import { Box } from "@langwatch/design-system/primitives";
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
    paddingBottom: "6",
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
      bg: "bg.muted",
      color: "fg",
      borderWidth: "1px",
      borderColor: "border",
      fontSize: "13px",
      fontWeight: "600",
    },
    "&:not(:last-of-type)::after": {
      content: '""',
      position: "absolute",
      insetInlineStart: "13.5px",
      top: "36px",
      bottom: "8px",
      width: "1px",
      bg: "border.muted",
    },
    "&:last-of-type": { paddingBottom: "0" },
  },
} as const;

export function Steps({ children }: { children?: ReactNode }) {
  return (
    <Box as="ol" marginY="6" css={STEPS_CSS}>
      {children}
    </Box>
  );
}

export function Step({ title, icon, id, children }: { title?: string; icon?: string; id?: string; children?: ReactNode }) {
  return (
    <li>
      {title ? (
        <Box
          as="h3"
          id={id}
          display="flex"
          alignItems="center"
          gap="2"
          margin="0"
          marginBottom="2"
          fontSize="18px"
          lineHeight="28px"
          fontWeight="600"
          fontFamily="heading"
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
