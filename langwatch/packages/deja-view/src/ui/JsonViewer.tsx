import { Box, Text } from "ink";
import React from "react";

interface JsonViewerProps {
  data: unknown;
  maxLines?: number;
  scrollOffset?: number;
  /** Dim the output (for stale/unchanged state) */
  dimmed?: boolean;
}

type JsonToken =
  | { type: "key"; value: string }
  | { type: "string"; value: string }
  | { type: "number"; value: string }
  | { type: "boolean"; value: string }
  | { type: "null"; value: string }
  | { type: "punctuation"; value: string }
  | { type: "indent"; value: string };

/**
 * Tokenizes JSON string for syntax highlighting.
 *
 * @example
 * const tokens = tokenizeJson('{"key": "value"}');
 */
function tokenizeJson(jsonStr: string): JsonToken[][] {
  const lines = jsonStr.split("\n");

  return lines.map((line) => {
    const tokens: JsonToken[] = [];
    let i = 0;

    // Capture leading whitespace
    const indentMatch = line.match(/^(\s*)/);
    if (indentMatch?.[1]) {
      tokens.push({ type: "indent", value: indentMatch[1] });
      i = indentMatch[1].length;
    }

    while (i < line.length) {
      const char = line[i];

      // Key (quoted string followed by colon)
      if (char === '"') {
        const keyMatch = line.slice(i).match(/^"([^"\\]|\\.)*"\s*:/);
        if (keyMatch) {
          const keyPart = keyMatch[0].slice(0, -1).trimEnd(); // Remove trailing colon
          tokens.push({ type: "key", value: keyPart });
          i += keyPart.length;
          // Skip whitespace and colon
          while (i < line.length && (line[i] === " " || line[i] === ":")) {
            tokens.push({ type: "punctuation", value: line[i]! });
            i++;
          }
          continue;
        }

        // String value
        const strMatch = line.slice(i).match(/^"([^"\\]|\\.)*"/);
        if (strMatch) {
          tokens.push({ type: "string", value: strMatch[0] });
          i += strMatch[0].length;
          continue;
        }
      }

      // Number
      if (/[0-9-]/.test(char ?? "")) {
        const numMatch = line
          .slice(i)
          .match(/^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/);
        if (numMatch) {
          tokens.push({ type: "number", value: numMatch[0] });
          i += numMatch[0].length;
          continue;
        }
      }

      // Boolean / null
      const keywordMatch = line.slice(i).match(/^(true|false|null)/);
      if (keywordMatch) {
        const keyword = keywordMatch[0];
        tokens.push({
          type: keyword === "null" ? "null" : "boolean",
          value: keyword,
        });
        i += keyword.length;
        continue;
      }

      // Punctuation
      if (/[{}\[\],:]/.test(char ?? "")) {
        tokens.push({ type: "punctuation", value: char! });
        i++;
        continue;
      }

      // Whitespace or other
      i++;
    }

    return tokens;
  });
}

/**
 * Get the color for a token type.
 */
function getTokenColor(tokenType: JsonToken["type"]): string | undefined {
  switch (tokenType) {
    case "key":
      return "cyan";
    case "string":
      return "green";
    case "number":
      return "yellow";
    case "boolean":
      return "magenta";
    case "null":
      return "red";
    case "punctuation":
      return "gray";
    default:
      return undefined;
  }
}

/**
 * Renders a single token with appropriate color.
 * When dimmed, keeps syntax colors but reduces brightness.
 */
const TokenRenderer: React.FC<{ token: JsonToken; dimmed?: boolean }> = ({
  token,
  dimmed = false,
}) => {
  const color = getTokenColor(token.type);
  return (
    <Text color={color} dimColor={dimmed}>
      {token.value}
    </Text>
  );
};

/**
 * Syntax-highlighted JSON viewer for Ink terminal UI.
 *
 * Renders exactly `maxLines` lines of content (including scroll indicators),
 * since Ink does not clip overflow in the terminal.
 *
 * @example
 * <JsonViewer data={{ key: "value" }} maxLines={20} scrollOffset={0} />
 */
export const JsonViewer: React.FC<JsonViewerProps> = ({
  data,
  maxLines,
  scrollOffset = 0,
  dimmed = false,
}) => {
  const jsonStr = JSON.stringify(data, null, 2);
  const tokenizedLines = tokenizeJson(jsonStr);

  // Apply scroll offset
  const startLine = Math.min(
    scrollOffset,
    Math.max(0, tokenizedLines.length - 1),
  );

  // If maxLines is set, compute how many JSON lines fit after reserving space for indicators
  let effectiveMaxLines: number | undefined = undefined;
  if (maxLines !== undefined) {
    const hasMoreAbove = startLine > 0;
    const remainingLines = tokenizedLines.length - startLine;
    const hasMoreBelow = remainingLines > maxLines;

    // Reserve lines for indicators that will be shown
    const indicatorLines = (hasMoreAbove ? 1 : 0) + (hasMoreBelow ? 1 : 0);
    effectiveMaxLines = Math.max(1, maxLines - indicatorLines);
  }

  const endLine =
    effectiveMaxLines !== undefined
      ? startLine + effectiveMaxLines
      : tokenizedLines.length;
  const displayLines = tokenizedLines.slice(startLine, endLine);

  const hasMoreAbove = startLine > 0;
  const hasMoreBelow = endLine < tokenizedLines.length;

  return (
    <Box flexDirection="column" flexShrink={0}>
      {hasMoreAbove && <Text dimColor>↑ ({startLine} lines above)</Text>}
      {displayLines.map((lineTokens, lineIndex) => (
        <Text key={startLine + lineIndex}>
          {lineTokens.map((token, tokenIndex) => (
            <TokenRenderer key={tokenIndex} token={token} dimmed={dimmed} />
          ))}
        </Text>
      ))}
      {hasMoreBelow && (
        <Text dimColor>↓ ({tokenizedLines.length - endLine} lines below)</Text>
      )}
    </Box>
  );
};
