import { Box, Flex } from "@langwatch/design-system/primitives";
import { CircleCheck, Info as InfoGlyph, Lightbulb, StickyNote, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

type Kind = { heading: string; rule: string; glyph: typeof InfoGlyph; visibleLabel?: boolean };

const KINDS = {
  note: { heading: "Note", rule: "border.emphasized", glyph: StickyNote },
  info: { heading: "Info", rule: "blue.fg", glyph: InfoGlyph },
  tip: { heading: "Tip", rule: "green.fg", glyph: Lightbulb },
  warning: { heading: "Warning", rule: "yellow.fg", glyph: TriangleAlert, visibleLabel: true },
  check: { heading: "Check", rule: "green.fg", glyph: CircleCheck },
} satisfies Record<string, Kind>;

/** A quiet callout: a left rule, a status glyph and the article's own reading body. */
function Callout({ kind, children }: { kind: keyof typeof KINDS; children?: ReactNode }) {
  const { heading, rule, glyph: Glyph, visibleLabel } = KINDS[kind] as Kind;
  return (
    <Flex
      role="note"
      className="docs-callout"
      gap="3"
      alignItems="flex-start"
      marginY="6"
      paddingY="1"
      paddingInlineStart="4"
      borderInlineStartWidth="2px"
      borderInlineStartColor={rule}
      color="fg"
    >
      <Box as="span" color={rule === "border.emphasized" ? "fg.muted" : rule} marginTop="1" flexShrink={0} display="inline-flex">
        <Glyph size={20} aria-hidden="true" />
      </Box>
      <Box minWidth="0" flex="1">
        <Box as="span" className={visibleLabel ? undefined : "docs-sr-only"} display={visibleLabel ? "block" : undefined} fontFamily="body" fontSize="14px" lineHeight="20px" fontWeight="600" css={{ color: "inherit" }}>
          {heading}
          {visibleLabel ? null : ": "}
        </Box>
        <div>{children}</div>
      </Box>
    </Flex>
  );
}

export const Note = ({ children }: { children?: ReactNode }) => <Callout kind="note">{children}</Callout>;
export const Info = ({ children }: { children?: ReactNode }) => <Callout kind="info">{children}</Callout>;
export const Tip = ({ children }: { children?: ReactNode }) => <Callout kind="tip">{children}</Callout>;
export const Warning = ({ children }: { children?: ReactNode }) => <Callout kind="warning">{children}</Callout>;
export const Check = ({ children }: { children?: ReactNode }) => <Callout kind="check">{children}</Callout>;
