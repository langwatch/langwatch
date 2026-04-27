import { Box } from "@chakra-ui/react";
import { useMemo } from "react";

interface JsonToken {
  type: "key" | "string" | "number" | "boolean" | "null" | "punctuation";
  value: string;
}

function tokenizeJson(json: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  const regex =
    /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|(true|false)|(null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\]:,])|(\s+)/g;
  let match;

  while ((match = regex.exec(json)) !== null) {
    if (match[1] !== undefined) {
      tokens.push({ type: "key", value: match[1] });
      tokens.push({ type: "punctuation", value: ":" });
    } else if (match[2] !== undefined) {
      tokens.push({ type: "string", value: match[2] });
    } else if (match[3] !== undefined) {
      tokens.push({ type: "boolean", value: match[3] });
    } else if (match[4] !== undefined) {
      tokens.push({ type: "null", value: match[4] });
    } else if (match[5] !== undefined) {
      tokens.push({ type: "number", value: match[5] });
    } else if (match[6] !== undefined) {
      tokens.push({ type: "punctuation", value: match[6] });
    } else if (match[7] !== undefined) {
      tokens.push({ type: "punctuation", value: match[7] });
    }
  }

  return tokens;
}

const TOKEN_COLORS: Record<JsonToken["type"], string> = {
  key: "blue.fg",
  string: "green.fg",
  number: "orange.fg",
  boolean: "purple.fg",
  null: "fg.subtle",
  punctuation: "fg.muted",
};

export function HighlightedJson({ json }: { json: string }) {
  const tokens = useMemo(() => tokenizeJson(json), [json]);

  return (
    <>
      {tokens.map((token, i) => (
        <Box as="span" key={i} color={TOKEN_COLORS[token.type]}>
          {token.value}
        </Box>
      ))}
    </>
  );
}

export function JsonView({ content }: { content: string }) {
  try {
    const parsed = JSON.parse(content);
    const formatted = JSON.stringify(parsed, null, 2);
    return (
      <Box
        as="pre"
        textStyle="xs"
        fontFamily="mono"
        color="fg"
        whiteSpace="pre-wrap"
        wordBreak="break-all"
        lineHeight="tall"
      >
        <HighlightedJson json={formatted} />
      </Box>
    );
  } catch {
    return (
      <Box
        as="pre"
        textStyle="xs"
        fontFamily="mono"
        color="fg"
        whiteSpace="pre-wrap"
        wordBreak="break-all"
      >
        {content}
      </Box>
    );
  }
}
