import { Box, Textarea, type TextareaProps } from "@chakra-ui/react";
import type React from "react";
import { type Ref, useRef } from "react";

import { EXPRESSION_TOKEN_COLOR, tokeniseExpression } from "../../expression-tokens.ts";

interface ExpressionTextareaProps extends Omit<TextareaProps, "value"> {
  value: string;
  /** A span to underline as wrong, from `at` up to `end`, for example a refused construct. */
  mark?: { at: number; end: number };
  ref?: Ref<HTMLTextAreaElement>;
}

/** The text and the highlighted layer share every metric, so each glyph lands on its twin. */
const SHARED_METRICS = {
  fontFamily: "mono",
  fontVariantLigatures: "none",
  letterSpacing: "normal",
  textStyle: "sm",
  paddingX: "3",
  paddingY: "2",
  borderWidth: "1px",
  whiteSpace: "pre-wrap",
  overflowWrap: "break-word",
  wordBreak: "normal",
  scrollbarGutter: "stable",
} as const;

type Piece = { key: string; text: string; color: string; marked: boolean };

/** The tokens cut again at the mark's edges, so the underline starts and ends mid-token. */
function pieces({ value, mark }: { value: string; mark?: { at: number; end: number } }): Piece[] {
  return tokeniseExpression({ text: value }).flatMap((token) => {
    const end = token.at + token.text.length;
    const cuts = [token.at, end];
    if (mark) cuts.push(...[mark.at, mark.end].filter((cut) => cut > token.at && cut < end));
    const sorted = [...new Set(cuts)].toSorted((a, b) => a - b);
    return sorted.slice(0, -1).map((from, index) => ({
      key: `${from}`,
      text: value.slice(from, sorted[index + 1]),
      color: EXPRESSION_TOKEN_COLOR[token.kind],
      marked: mark !== undefined && from >= mark.at && from < mark.end,
    }));
  });
}

/**
 * A textarea for a filter expression that colours it as it is typed: the text is drawn by a layer
 * underneath, scrolled in step, while the caret, selection and placeholder stay the textarea's.
 */
export function ExpressionTextarea({
  value,
  mark,
  ref,
  onScroll,
  ...props
}: ExpressionTextareaProps): React.ReactElement {
  const layer = useRef<HTMLDivElement>(null);
  return (
    <Box position="relative" width="full">
      <Box
        ref={layer}
        aria-hidden
        data-testid="expression-textarea-highlight"
        position="absolute"
        inset={0}
        overflow="hidden"
        borderColor="transparent"
        color="fg"
        pointerEvents="none"
        {...SHARED_METRICS}
      >
        {pieces({ value, mark }).map((piece) => (
          <Box
            as="span"
            key={piece.key}
            color={piece.color}
            {...(piece.marked
              ? {
                  "data-mark": "",
                  textDecoration: "underline wavy",
                  textDecorationColor: "fg.error",
                }
              : {})}
          >
            {piece.text}
          </Box>
        ))}
        {/* A trailing newline needs a glyph after it, or the layer ends a line short. */}
        {"\u200b"}
      </Box>
      <Textarea
        ref={ref}
        value={value}
        position="relative"
        bg="transparent"
        color="transparent"
        caretColor="fg"
        _placeholder={{ color: "fg.subtle" }}
        _selection={{ bg: "blue.muted", color: "transparent" }}
        onScroll={(event) => {
          if (layer.current) layer.current.scrollTop = event.currentTarget.scrollTop;
          onScroll?.(event);
        }}
        {...SHARED_METRICS}
        {...props}
      />
    </Box>
  );
}
