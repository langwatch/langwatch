import { Box, ClientOnly, CodeBlock } from "@chakra-ui/react";
import { useMemo } from "react";
import { useColorMode } from "~/components/ui/color-mode";

const KEY_LINE_REGEX = /^"([^"]+)":/;
const OPENS_OBJECT_REGEX = /\{$/;
const CLOSES_OBJECT_REGEX = /^\}/;

/**
 * Tolerant prettifier — when `JSON.parse` fails (truncated payloads, NDJSON
 * fragments, single-line crammed objects), fall back to a structural
 * indenter that at least produces line-per-key output without erroring.
 */
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
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") continue;
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

/**
 * Walk pretty-printed JSON lines once to compute the 1-indexed line numbers
 * that should be highlighted given a set of pinned dot-paths. A line is
 * marked when its own key matches a pinned path *or* any of its object
 * ancestors does — pinning a parent visually hits the whole subtree.
 */
function computeHighlightLines(
  lines: string[],
  pinnedKeys: ReadonlySet<string>,
): number[] {
  const path: string[] = [];
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    const keyMatch = KEY_LINE_REGEX.exec(trimmed);
    const key = keyMatch?.[1];
    const opensObject = OPENS_OBJECT_REGEX.test(trimmed);
    const closesObject = CLOSES_OBJECT_REGEX.test(trimmed);

    if (closesObject && path.length > 0) path.pop();

    const fullPath = key ? [...path, key].join(".") : null;
    const pinned =
      fullPath != null &&
      (pinnedKeys.has(fullPath) ||
        path.some((_, j) => pinnedKeys.has(path.slice(0, j + 1).join("."))));

    if (pinned) out.push(i + 1); // 1-indexed for shiki/Chakra `meta.highlightLines`

    if (key && opensObject) path.push(key);
  }
  return out;
}

/**
 * JSON viewer with a left-rail accent on lines whose key matches one of
 * `pinnedKeys`. We hand Shiki the highlight line numbers via Chakra's
 * `meta.highlightLines` and let the adapter mark them with `.highlighted`
 * / `data-highlight=""`. CSS below recolours the default highlight to our
 * blue tracing accent — same approach the empty-state card uses for its
 * orange highlight on env-block lines.
 *
 * Tokenisation goes through the ambient `<CodeBlock.AdapterProvider>` at
 * `TraceV2DrawerShell` (one shared Highlighter for the whole drawer).
 */
export function PinnedAwareJsonView({
  content,
  pinnedKeys,
}: {
  content: string;
  pinnedKeys: ReadonlySet<string>;
}) {
  const { colorMode } = useColorMode();
  const formatted = useMemo(() => safePrettyJson(content), [content]);
  const highlightLines = useMemo(
    () => computeHighlightLines(formatted.split("\n"), pinnedKeys),
    [formatted, pinnedKeys],
  );

  // The orange highlight is applied globally in `pages/_app.tsx` via
  // `--highlight-bg` + the `::after` pseudo on `[data-line][data-highlight]`
  // — every Chakra `CodeBlock` with `meta.highlightLines` picks it up.
  return (
    <ClientOnly
      fallback={
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
          {formatted}
        </Box>
      }
    >
      {() => (
        <CodeBlock.Root
          size="sm"
          code={formatted}
          language="json"
          meta={{ highlightLines, colorScheme: colorMode }}
          bg="transparent"
          borderWidth={0}
          borderRadius={0}
          overflow="hidden"
        >
          <CodeBlock.Content
            paddingX={0}
            paddingY={0}
            css={{
              "& pre, & code": {
                background: "transparent !important",
                fontSize: "0.78em",
                lineHeight: "1.6",
                padding: "0 !important",
                margin: "0 !important",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              },
            }}
          >
            <CodeBlock.Code>
              <CodeBlock.CodeText />
            </CodeBlock.Code>
          </CodeBlock.Content>
        </CodeBlock.Root>
      )}
    </ClientOnly>
  );
}
