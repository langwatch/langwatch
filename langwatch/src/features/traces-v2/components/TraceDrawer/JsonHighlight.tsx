import { Box } from "@chakra-ui/react";
import { useMemo } from "react";

interface JsonToken {
  type: "key" | "string" | "number" | "boolean" | "null" | "punctuation";
  value: string;
}

const TOKEN_REGEX =
  /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|(true|false)|(null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\]:,])|(\s+)/g;

const TOKEN_COLORS: Record<JsonToken["type"], string> = {
  key: "blue.fg",
  string: "green.fg",
  number: "orange.fg",
  boolean: "purple.fg",
  null: "fg.subtle",
  punctuation: "fg.muted",
};

const KEY_LINE_REGEX = /^"([^"]+)":/;
const OPENS_OBJECT_REGEX = /\{$/;
const CLOSES_OBJECT_REGEX = /^\}/;

function tokenizeJson(json: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  TOKEN_REGEX.lastIndex = 0;
  let match;
  while ((match = TOKEN_REGEX.exec(json)) !== null) {
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

function tolerantPrettyJson(content: string): string {
  const indentUnit = "  ";
  let depth = 0;
  let inString = false;
  let escaped = false;
  let out = "";

  const indent = (level: number) => indentUnit.repeat(Math.max(level, 0));

  for (const ch of content) {
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      continue;
    }

    if (ch === "{" || ch === "[") {
      out += ch;
      depth += 1;
      out += "\n" + indent(depth);
      continue;
    }

    if (ch === "}" || ch === "]") {
      depth = Math.max(depth - 1, 0);
      out += "\n" + indent(depth) + ch;
      continue;
    }

    if (ch === ",") {
      out += ch;
      out += "\n" + indent(depth);
      continue;
    }

    if (ch === ":") {
      out += ": ";
      continue;
    }

    out += ch;
  }

  return out;
}

export function safePrettyJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return tolerantPrettyJson(content);
  }
}

function HighlightedJson({ json }: { json: string }) {
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

interface DecoratedLine {
  line: string;
  pinned: boolean;
}

function decorateLines(
  lines: string[],
  pinnedKeys: ReadonlySet<string>,
): DecoratedLine[] {
  const path: string[] = [];
  return lines.map((line) => {
    const trimmed = line.trim();
    const keyMatch = KEY_LINE_REGEX.exec(trimmed);
    const key = keyMatch?.[1];
    const opensObject = OPENS_OBJECT_REGEX.test(trimmed);
    const closesObject = CLOSES_OBJECT_REGEX.test(trimmed);

    if (closesObject && path.length > 0) path.pop();

    const fullPath = key ? [...path, key].join(".") : null;
    const pinned =
      fullPath != null &&
      (pinnedKeys.has(fullPath) ||
        path.some((_, i) => pinnedKeys.has(path.slice(0, i + 1).join("."))));

    if (key && opensObject) path.push(key);
    return { line, pinned };
  });
}

/**
 * JSON viewer with a left-rail accent on lines whose key matches one of
 * `pinnedKeys`. Uses our regex tokeniser so we can render line-by-line and
 * decorate each row independently — Shiki produces a single HTML blob,
 * which doesn't lend itself to per-line overlays.
 */
export function PinnedAwareJsonView({
  content,
  pinnedKeys,
}: {
  content: string;
  pinnedKeys: ReadonlySet<string>;
}) {
  const formatted = useMemo(() => safePrettyJson(content), [content]);
  const decoratedLines = useMemo(
    () => decorateLines(formatted.split("\n"), pinnedKeys),
    [formatted, pinnedKeys],
  );

  return (
    <Box
      as="pre"
      textStyle="xs"
      fontFamily="mono"
      color="fg"
      whiteSpace="pre-wrap"
      wordBreak="break-all"
      lineHeight="tall"
      margin={0}
    >
      {decoratedLines.map(({ line, pinned }, i) => (
        <Box
          key={i}
          paddingLeft={2}
          marginLeft={-2}
          borderLeftWidth="2px"
          borderLeftColor={pinned ? "blue.solid" : "transparent"}
          bg={pinned ? "blue.solid/8" : "transparent"}
        >
          <HighlightedJson json={line} />
        </Box>
      ))}
    </Box>
  );
}
