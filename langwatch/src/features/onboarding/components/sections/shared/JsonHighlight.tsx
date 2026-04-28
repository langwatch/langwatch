import { Box } from "@chakra-ui/react";
import type React from "react";
import { useColorMode } from "~/components/ui/color-mode";

type TokenType =
  | "property"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "punctuation"
  | "operator"
  | "whitespace";

interface Token {
  type: TokenType;
  value: string;
}

const lightColors: Record<TokenType, string> = {
  property: "#005cc5",
  string: "#22863a",
  number: "#e36209",
  boolean: "#e36209",
  null: "#e36209",
  punctuation: "#586069",
  operator: "#d73a49",
  whitespace: "inherit",
};

const darkColors: Record<TokenType, string> = {
  property: "#79b8ff",
  string: "#85e89d",
  number: "#ffab70",
  boolean: "#ffab70",
  null: "#ffab70",
  punctuation: "#959da5",
  operator: "#f97583",
  whitespace: "inherit",
};

function tokenizeJson(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const c = input[i]!;

    // whitespace (preserve as-is for formatting)
    if (c === " " || c === "\n" || c === "\t" || c === "\r") {
      let end = i;
      while (
        end < len &&
        (input[end] === " " ||
          input[end] === "\n" ||
          input[end] === "\t" ||
          input[end] === "\r")
      ) {
        end++;
      }
      tokens.push({ type: "whitespace", value: input.slice(i, end) });
      i = end;
      continue;
    }

    // string (property if followed by :, otherwise string value)
    if (c === '"') {
      let end = i + 1;
      while (end < len && input[end] !== '"') {
        if (input[end] === "\\" && end + 1 < len) end += 2;
        else end++;
      }
      end++; // include closing quote
      const value = input.slice(i, end);

      // look ahead for ":" (skipping whitespace) to classify as property
      let after = end;
      while (
        after < len &&
        (input[after] === " " ||
          input[after] === "\n" ||
          input[after] === "\t" ||
          input[after] === "\r")
      ) {
        after++;
      }
      const isProperty = input[after] === ":";

      tokens.push({ type: isProperty ? "property" : "string", value });
      i = end;
      continue;
    }

    // number
    if (c === "-" || (c >= "0" && c <= "9")) {
      let end = i;
      if (input[end] === "-") end++;
      while (
        end < len &&
        ((input[end]! >= "0" && input[end]! <= "9") ||
          input[end] === "." ||
          input[end] === "e" ||
          input[end] === "E" ||
          input[end] === "+" ||
          input[end] === "-")
      ) {
        end++;
      }
      tokens.push({ type: "number", value: input.slice(i, end) });
      i = end;
      continue;
    }

    // true / false
    if (input.slice(i, i + 4) === "true") {
      tokens.push({ type: "boolean", value: "true" });
      i += 4;
      continue;
    }
    if (input.slice(i, i + 5) === "false") {
      tokens.push({ type: "boolean", value: "false" });
      i += 5;
      continue;
    }

    // null
    if (input.slice(i, i + 4) === "null") {
      tokens.push({ type: "null", value: "null" });
      i += 4;
      continue;
    }

    // punctuation
    if (c === "{" || c === "}" || c === "[" || c === "]" || c === ",") {
      tokens.push({ type: "punctuation", value: c });
      i++;
      continue;
    }

    // operator (colon)
    if (c === ":") {
      tokens.push({ type: "operator", value: c });
      i++;
      continue;
    }

    // fallback — emit single char as whitespace so we never crash on unknown input
    tokens.push({ type: "whitespace", value: c });
    i++;
  }

  return tokens;
}

/**
 * Walk tokens once and split them into per-line groups so each line can be
 * rendered as its own block element. Whitespace tokens that contain a
 * newline are split between the lines they straddle so the leading
 * indentation of the next line lands on that line's element.
 */
function splitTokensIntoLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const token of tokens) {
    if (token.type === "whitespace" && token.value.includes("\n")) {
      const parts = token.value.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) {
          lines[lines.length - 1]!.push({
            type: "whitespace",
            value: parts[i]!,
          });
        }
        if (i < parts.length - 1) lines.push([]);
      }
    } else {
      lines[lines.length - 1]!.push(token);
    }
  }
  return lines;
}

export function JsonHighlight({
  code,
  highlightLines,
}: {
  code: string;
  /**
   * 1-indexed line numbers to call out with a background tint. Used by
   * the empty-state onboarding to flag the env-var lines (API key,
   * project id, endpoint) the user actually has to copy.
   */
  highlightLines?: number[];
}): React.ReactElement {
  const { colorMode } = useColorMode();
  const colors = colorMode === "dark" ? darkColors : lightColors;
  const baseColor = colorMode === "dark" ? "#e1e4e8" : "#24292e";

  const tokens = tokenizeJson(code);
  const lines = splitTokensIntoLines(tokens);
  const highlightSet = new Set(highlightLines ?? []);
  // LangWatch's tracing accent — kept in-line so the highlight tracks
  // colour-mode without depending on a Chakra theme token.
  const highlightBg =
    colorMode === "dark"
      ? "rgba(237,137,38,0.18)"
      : "rgba(237,137,38,0.12)";

  return (
    <Box
      px={5}
      py={4}
      pr={12}
      fontSize="12.5px"
      fontFamily="'Geist Mono', 'IBM Plex Mono', 'Source Code Pro', Menlo, monospace"
      lineHeight="1.8"
      overflowX="hidden"
      letterSpacing="0.01em"
      style={{
        background: "transparent",
        color: baseColor,
        margin: 0,
        whiteSpace: "pre",
      }}
    >
      {lines.map((lineTokens, lineIdx) => {
        const isHighlighted = highlightSet.has(lineIdx + 1);
        return (
          <Box
            as="div"
            key={lineIdx}
            // Stretch the highlight to the full code-block width by negating
            // the parent's horizontal padding. Without this the tint clips
            // to the rendered token width and reads like a typo.
            mx={isHighlighted ? -5 : 0}
            px={isHighlighted ? 5 : 0}
            style={{
              background: isHighlighted ? highlightBg : "transparent",
              borderLeft: isHighlighted
                ? "2px solid rgba(237,137,38,0.6)"
                : undefined,
              paddingLeft: isHighlighted ? "calc(1.25rem - 2px)" : undefined,
            }}
          >
            {lineTokens.map((token, tokenIdx) => (
              <span
                key={tokenIdx}
                style={{
                  color:
                    token.type === "whitespace"
                      ? undefined
                      : colors[token.type],
                }}
              >
                {token.value}
              </span>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}
