import { chakra } from "@chakra-ui/react";
import { Fragment, memo, useMemo } from "react";
import {
  type AnsiSegment,
  type AnsiStyle,
  parseAnsi,
} from "../../../utils/ansi/ansi";
import { ansiColorToken, TERMINAL_TOKENS } from "./palette";

/**
 * Render a raw string that may contain ANSI escape codes as selectable,
 * theme-aware coloured monospace text. The escape codes never reach the DOM —
 * `parseAnsi` turns them into styled segments, so the visible (and therefore
 * copyable) text is clean. Newlines are preserved as real text nodes between
 * segments so a click-drag selection copies exactly what's on screen.
 */
export const AnsiText = memo(function AnsiText({ text }: { text: string }) {
  const lines = useMemo(() => parseAnsi(text), [text]);

  return (
    <chakra.pre
      margin={0}
      fontFamily="mono"
      fontSize="12px"
      lineHeight="1.55"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
      // Selectable so operators can drag-select and copy, exactly like a
      // terminal. The selection highlight uses a semantic token.
      userSelect="text"
      css={{ "&::selection, & ::selection": { bg: "blue.subtle" } }}
    >
      {lines.map((line, lineIndex) => (
        <Fragment key={lineIndex}>
          {line.segments.map((segment, segIndex) => (
            <AnsiSpan key={segIndex} segment={segment} />
          ))}
          {lineIndex < lines.length - 1 ? "\n" : null}
        </Fragment>
      ))}
    </chakra.pre>
  );
});

function AnsiSpan({ segment }: { segment: AnsiSegment }) {
  const { text, style } = segment;
  const css = styleToChakraProps(style);
  // A run with no styling renders as a bare text node so it inherits the
  // screen's default foreground and adds no DOM weight.
  if (css === null) return <>{text}</>;
  return <chakra.span {...css}>{text}</chakra.span>;
}

/**
 * Translate a parsed {@link AnsiStyle} into Chakra style props. Returns null
 * when the run carries no styling (so the caller can skip the wrapper). Inverse
 * video swaps foreground/background, falling back to the screen tokens when a
 * side is unset — matching how a real terminal renders `\x1b[7m`.
 */
function styleToChakraProps(style: AnsiStyle): Record<string, unknown> | null {
  const hasAny =
    style.fg ||
    style.bg ||
    style.bold ||
    style.dim ||
    style.italic ||
    style.underline ||
    style.inverse ||
    style.strikethrough;
  if (!hasAny) return null;

  const fg = style.fg ? ansiColorToken(style.fg) : undefined;
  const bg = style.bg ? ansiColorToken(style.bg) : undefined;

  let color = fg;
  let background = bg;
  if (style.inverse) {
    color = bg ?? TERMINAL_TOKENS.screenBg;
    background = fg ?? TERMINAL_TOKENS.screenFg;
  }

  const decorations: string[] = [];
  if (style.underline) decorations.push("underline");
  if (style.strikethrough) decorations.push("line-through");

  const props: Record<string, unknown> = {};
  if (color) props.color = color;
  if (background) props.bg = background;
  if (style.bold) props.fontWeight = "bold";
  // Dim reduces intensity; a terminal renders it as a lower-contrast run.
  if (style.dim) props.opacity = 0.6;
  if (style.italic) props.fontStyle = "italic";
  if (decorations.length > 0) props.textDecoration = decorations.join(" ");
  // Give an inverse/background run a little horizontal breathing room so the
  // highlight doesn't butt right up against neighbouring glyphs.
  if (background) props.borderRadius = "2px";
  return props;
}
