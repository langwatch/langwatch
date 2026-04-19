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

export function JsonHighlight({
  code,
}: {
  code: string;
}): React.ReactElement {
  const { colorMode } = useColorMode();
  const colors = colorMode === "dark" ? darkColors : lightColors;
  const baseColor = colorMode === "dark" ? "#e1e4e8" : "#24292e";

  const tokens = tokenizeJson(code);

  return (
    <Box
      as="pre"
      px={5}
      py={4}
      pr={12}
      fontSize="12.5px"
      fontFamily="'Geist Mono', 'IBM Plex Mono', 'Source Code Pro', Menlo, monospace"
      lineHeight="1.8"
      overflowX="hidden"
      whiteSpace="pre-wrap"
      wordBreak="break-all"
      letterSpacing="0.01em"
      style={{ background: "transparent", color: baseColor, margin: 0 }}
    >
      {tokens.map((token, idx) => (
        <span
          key={idx}
          style={{
            color:
              token.type === "whitespace" ? undefined : colors[token.type],
          }}
        >
          {token.value}
        </span>
      ))}
    </Box>
  );
}
