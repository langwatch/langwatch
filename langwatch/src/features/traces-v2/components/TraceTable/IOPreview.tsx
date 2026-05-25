import { chakra, Flex, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { ArrowDown, ArrowUp, Bot, User, Wrench } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import type React from "react";
import { useDensityTokens } from "../../hooks/useDensityTokens";
import { useDensityStore } from "../../stores/densityStore";
import { formatPreview } from "../../utils/previewFormatter";
import { tryParseChat } from "./chatContent";

const COMFORTABLE_LABEL_WIDTH = "60px";

interface IOPreviewProps {
  input: string | null;
  output: string | null;
}

export const IOPreview: React.FC<IOPreviewProps> = ({ input, output }) => {
  const density = useDensityStore((s) => s.density);
  if (density === "comfortable") {
    return <ComfortableIOPreview input={input} output={output} />;
  }
  return <CompactIOPreview input={input} output={output} />;
};

/**
 * Build the row data once per cell. `formatPreview` runs the unified
 * unwrap/strip/glyph pipeline; `tryParseChat` is still consulted for the
 * isChat/isTool flags that drive the role icon. Both are cheap (each does
 * one JSON.parse attempt on the same input).
 */
/**
 * Non-selectable hard-newline marker, rendered at the END of the line
 * that was broken — same affordance as a GitHub diff's `+`/`-` gutter:
 * visible, but never part of what you select and copy.
 *
 * Two properties make that work:
 *  - The glyph lives in a `::after` pseudo-element. Pseudo content is
 *    never part of the DOM text, so it can't be selected or copied in
 *    any browser (more robust than `user-select: none` alone, which
 *    Firefox still copies). `user-select: none` is kept as a belt to
 *    the pseudo's suspenders.
 *  - The span itself is zero-width with `overflow: visible`, so the
 *    glyph hangs past the last character without consuming layout
 *    width. It therefore can't push the line wider, can't wrap onto a
 *    line of its own, and can't be the lonely "↵…" the old leading-
 *    glyph approach was working around.
 */
const BreakMarker = () => (
  <chakra.span
    data-newline-marker=""
    aria-hidden="true"
    userSelect="none"
    display="inline-block"
    width="0"
    overflow="visible"
    whiteSpace="nowrap"
    verticalAlign="baseline"
    color="fg.subtle"
    css={{ "&::after": { content: '"↵"', marginInlineStart: "2px" } }}
  />
);

/**
 * Render preview text with a hard break shown as a trailing `BreakMarker`
 * on each broken line, followed by a real `\n` (the parent `Text` uses
 * `whiteSpace="pre-line"`, so the `\n` produces the actual visual wrap).
 * The text nodes stay clean — only the line content lands in the DOM, so
 * a copy of the selection round-trips to the original two-line string.
 */
function renderWithBreakMarkers(text: string): ReactNode {
  // Trim trailing whitespace/newlines so we never end on a break, and
  // collapse runs of blank lines to a single break point.
  const trimmed = text.replace(/\s+$/u, "");
  const lines = trimmed.split(/\n+/);
  if (lines.length <= 1) return trimmed;
  return lines.map((line, i) => (
    <Fragment key={i}>
      {line}
      {i < lines.length - 1 && (
        <>
          <BreakMarker />
          {"\n"}
        </>
      )}
    </Fragment>
  ));
}

function buildRow(raw: string | null): {
  text: string;
  isChat: boolean;
  isTool: boolean;
} {
  if (raw === null) return { text: "", isChat: false, isTool: false };
  const parsed = tryParseChat(raw);
  // Keep newlines as real `\n` — the row text renders them with
  // `whiteSpace="pre-line"`, and `renderWithBreakMarkers` decorates each
  // break with a non-selectable marker at render time.
  const formatted = formatPreview(raw, { maxChars: 200, newlines: "preserve" });
  return {
    text: formatted.text,
    isChat: parsed.isChat,
    isTool: parsed.isTool,
  };
}

const CompactIOPreview: React.FC<IOPreviewProps> = ({ input, output }) => {
  const tokens = useDensityTokens();
  return (
    <VStack align="start" gap={0.5} fontFamily="mono">
      {input !== null && (
        <CompactRow
          row={buildRow(input)}
          fontSize={tokens.ioFontSize}
          direction="input"
        />
      )}
      {output !== null && (
        <CompactRow
          row={buildRow(output)}
          fontSize={tokens.ioFontSize}
          direction="output"
        />
      )}
    </VStack>
  );
};

interface CompactRowProps {
  row: { text: string; isChat: boolean; isTool: boolean };
  fontSize: string;
  direction: "input" | "output";
}

const CompactRow: React.FC<CompactRowProps> = ({
  row,
  fontSize,
  direction,
}) => {
  const isInput = direction === "input";
  // Vivid palette in light mode — `*.solid` matches the saturated tone
  // the filter sidebar uses for the origin dots, so the table accents
  // and the sidebar legend feel like the same palette. Dark mode keeps
  // `*.fg` because against the dark canvas the solid step over-pops.
  const accent = isInput
    ? { base: "blue.500", _dark: "blue.fg" }
    : { base: "green.solid", _dark: "green.fg" };
  const textColor = isInput ? "fg.muted" : "fg.subtle";

  return (
    <HStack gap={1} width="full" overflow="hidden" align="flex-start">
      {/* Removed the dashed vertical bar that used to sit before the
          arrow icon — it read as visual noise and didn't add an
          alignment cue the row tint isn't already providing. */}
      <Flex align="center" gap={1} flexShrink={0} paddingTop="2px">
        <Icon boxSize="10px" color={accent}>
          {isInput ? <ArrowUp /> : <ArrowDown />}
        </Icon>
        <RoleIcon row={row} color={accent} direction={direction} />
      </Flex>
      <Text
        fontSize={fontSize}
        color={textColor}
        fontStyle="italic"
        fontWeight="400"
        // Preserve real newlines coming through formatPreview (the row
        // text used to inline-render `↵` glyphs — now wraps onto a real
        // second line). Cap at 2 lines so the preview stays compact in
        // the table.
        whiteSpace="pre-line"
        lineClamp={2}
        flex={1}
        minWidth={0}
      >
        {renderWithBreakMarkers(row.text)}
      </Text>
    </HStack>
  );
};

const RoleIcon: React.FC<{
  row: { isChat: boolean; isTool: boolean };
  color: string | { base: string; _dark: string };
  direction: "input" | "output";
}> = ({ row, color, direction }) => {
  if (direction === "input") {
    return row.isChat ? (
      <Icon boxSize="10px" color={color}>
        <User />
      </Icon>
    ) : null;
  }
  if (row.isTool) {
    return (
      <Icon boxSize="10px" color={color}>
        <Wrench />
      </Icon>
    );
  }
  if (row.isChat) {
    return (
      <Icon boxSize="10px" color={color}>
        <Bot />
      </Icon>
    );
  }
  return null;
};

const ComfortableIOPreview: React.FC<IOPreviewProps> = ({ input, output }) => (
  <VStack align="stretch" gap={2} fontFamily="mono">
    {input !== null && (
      <ComfortableRow
        label="Input"
        labelColor={{ base: "blue.500", _dark: "blue.fg" }}
        textColor="fg.muted"
        text={formatPreview(input, { maxChars: 200, newlines: "preserve" }).text}
      />
    )}
    {output !== null && (
      <ComfortableRow
        label="Output"
        labelColor={{ base: "green.solid", _dark: "green.fg" }}
        textColor="fg"
        text={formatPreview(output, { maxChars: 200, newlines: "preserve" }).text}
      />
    )}
  </VStack>
);

const ComfortableRow: React.FC<{
  label: string;
  labelColor: string | { base: string; _dark: string };
  textColor: string;
  text: string;
}> = ({ label, labelColor, textColor, text }) => (
  <HStack align="flex-start" gap={2}>
    <Text
      textStyle="sm"
      fontWeight="600"
      color={labelColor}
      flexShrink={0}
      width={COMFORTABLE_LABEL_WIDTH}
    >
      {label}
    </Text>
    <Text
      textStyle="sm"
      color={textColor}
      whiteSpace="pre-line"
      lineClamp={2}
      flex={1}
      minWidth={0}
    >
      {renderWithBreakMarkers(text)}
    </Text>
  </HStack>
);
