import { Box, Flex } from "@langwatch/design-system/primitives";
import { CircleCheck, Info as InfoGlyph, Lightbulb, StickyNote, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

type Kind = {
  heading: string;
  rule: string;
  palette: string;
  glyph: typeof InfoGlyph;
  visibleLabel?: boolean;
};

const KINDS = {
  note: { heading: "Note", rule: "fg.muted", palette: "gray", glyph: StickyNote },
  info: { heading: "Info", rule: "blue.fg", palette: "blue", glyph: InfoGlyph },
  tip: { heading: "Tip", rule: "green.fg", palette: "green", glyph: Lightbulb },
  warning: {
    heading: "Warning",
    rule: "yellow.fg",
    palette: "yellow",
    glyph: TriangleAlert,
    visibleLabel: true,
  },
  check: { heading: "Check", rule: "green.fg", palette: "green", glyph: CircleCheck },
} satisfies Record<string, Kind>;

/** Tinted Mintlify callouts retain a status glyph and accessible semantic colours. */
function Callout({ kind, children }: { kind: keyof typeof KINDS; children?: ReactNode }) {
  const style: Kind = KINDS[kind];
  const { heading, rule, palette, glyph: Glyph, visibleLabel } = style;
  return (
    <Flex
      role="note"
      className="docs-callout"
      gap="3"
      alignItems="flex-start"
      marginY="6"
      padding="4"
      borderWidth="1px"
      borderColor={`${palette}.muted`}
      borderRadius="xl"
      bg={`${palette}.subtle`}
      color={rule}
      css={{
        _dark: {
          background: `color-mix(in srgb, var(--chakra-colors-${palette}-solid) 10%, var(--chakra-colors-docs-paper))`,
          borderColor: `color-mix(in srgb, var(--chakra-colors-${palette}-solid) 25%, var(--chakra-colors-docs-paper))`,
        },
      }}
    >
      <Box
        as="span"
        color={rule === "border.emphasized" ? "fg.muted" : rule}
        marginTop="0"
        flexShrink={0}
        display="inline-flex"
      >
        <Glyph size={20} aria-hidden="true" />
      </Box>
      <Box minWidth="0" flex="1">
        <Box
          as="span"
          className={visibleLabel ? undefined : "docs-sr-only"}
          display={visibleLabel ? "block" : undefined}
          fontFamily="body"
          fontSize="14px"
          lineHeight="20px"
          fontWeight="600"
          css={{ color: "inherit" }}
        >
          {heading}
          {visibleLabel ? null : ": "}
        </Box>
        <div>{children}</div>
      </Box>
    </Flex>
  );
}

export const Note = ({ children }: { children?: ReactNode }) => (
  <Callout kind="note">{children}</Callout>
);
export const Info = ({ children }: { children?: ReactNode }) => (
  <Callout kind="info">{children}</Callout>
);
export const Tip = ({ children }: { children?: ReactNode }) => (
  <Callout kind="tip">{children}</Callout>
);
export const Warning = ({ children }: { children?: ReactNode }) => (
  <Callout kind="warning">{children}</Callout>
);
export const Check = ({ children }: { children?: ReactNode }) => (
  <Callout kind="check">{children}</Callout>
);
