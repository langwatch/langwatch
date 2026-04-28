import { Box, ClientOnly, CodeBlock } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { codeToHtml } from "shiki";
import { useShikiAdapter } from "./shikiAdapter";
import { thinkingShimmer } from "./thinking";

/**
 * Lean Shiki renderer: calls `codeToHtml` directly and drops the result in
 * one mounting element. No `CodeBlock.Root → Content → Code → CodeText`
 * ladder, no outer "preview card" chrome. Shiki returns its own
 * `<pre><code>…</code></pre>` — we use `display: contents` on the mount
 * div so it hoists Shiki's `<pre>` to the parent's layout level.
 */
export function ShikiHighlight({
  code,
  language,
  colorMode,
}: {
  code: string;
  language: string;
  colorMode: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const theme = colorMode === "dark" ? "github-dark" : "github-light";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await codeToHtml(code, { lang: language, theme });
        if (!cancelled) setHtml(result);
      } catch {
        if (!cancelled) setHtml(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, language, theme]);

  // After Shiki mounts its HTML, walk the resulting DOM and decorate any
  // text node containing the 🧠 thinking marker. Doing this post-mount
  // (rather than via a regex on the HTML string) is robust: Shiki's
  // tokenisation can split emojis/punctuation across spans in ways a
  // regex can't reliably match, but a TreeWalker just finds the text and
  // tags its parent span regardless of how the tokens shake out.
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (html == null) return;
    const root = containerRef.current;
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeValue?.includes("🧠")) targets.push(node as Text);
    }
    for (const text of targets) {
      const parent = text.parentElement;
      if (!parent || parent.classList.contains("thinking-shimmer")) continue;
      parent.classList.add("thinking-shimmer");
      parent.setAttribute("title", "Thinking");
    }
    // Strip the marker glyph (and the following space) from rendered text
    // — keep the run intact in source but quiet it visually.
    for (const text of targets) {
      if (text.nodeValue) {
        text.nodeValue = text.nodeValue.replace(/🧠\s?/g, "");
      }
    }
  }, [html]);

  if (html == null) {
    return (
      <Box
        as="pre"
        margin={0}
        padding={0}
        bg="transparent"
        fontFamily="mono"
        fontSize="0.8em"
        lineHeight="1.55"
        whiteSpace="pre-wrap"
        wordBreak="break-word"
        color="fg"
      >
        {code}
      </Box>
    );
  }

  return (
    <Box
      ref={containerRef}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
      display="contents"
      css={{
        "& > pre": {
          margin: 0,
          padding: 0,
          background: "transparent !important",
          fontFamily: "var(--chakra-fonts-mono)",
          fontSize: "0.8em",
          lineHeight: "1.55",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        },
        "& code": { fontFamily: "inherit" },
        "& .thinking-shimmer": {
          fontStyle: "italic",
          backgroundImage:
            "linear-gradient(100deg, currentColor 30%, rgba(255,255,255,0.7) 50%, currentColor 70%) !important",
          backgroundSize: "200% auto",
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          color: "transparent !important",
          animation: `${thinkingShimmer} 3s linear infinite`,
          cursor: "help",
          "& *": {
            color: "inherit !important",
            background: "inherit !important",
            backgroundClip: "inherit !important",
            WebkitBackgroundClip: "inherit !important",
          },
        },
        "@media (prefers-reduced-motion: reduce)": {
          "& .thinking-shimmer": { animation: "none" },
        },
      }}
    />
  );
}

export function ShikiCodeBlock({
  code,
  language,
  colorMode,
  flush,
}: {
  code: string;
  language: string;
  colorMode: string;
  flush?: boolean;
}) {
  // Self-contained: wraps its own AdapterProvider so call sites don't need
  // to remember to set one up. Without this, Shiki silently no-ops and the
  // block renders unstyled mono text — which was the bug behind "syntax
  // highlighting isn't working anywhere."
  const shikiAdapter = useShikiAdapter(colorMode);
  return (
    <CodeBlock.AdapterProvider value={shikiAdapter}>
      <ClientOnly
        fallback={
          <Box
            as="pre"
            textStyle="xs"
            fontFamily="mono"
            color="fg"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            lineHeight="1.6"
            padding={flush ? 4 : 2.5}
            borderRadius={flush ? 0 : "md"}
            borderWidth={flush ? 0 : "1px"}
            borderColor="border.muted"
            bg={flush ? "transparent" : "bg.subtle"}
            marginBottom={flush ? 0 : 2}
          >
            {code}
          </Box>
        }
      >
        {() => (
          <CodeBlock.Root
            size="sm"
            code={code}
            language={language}
            meta={{ colorScheme: colorMode }}
            borderRadius={flush ? 0 : "md"}
            borderWidth={flush ? 0 : "1px"}
            borderColor="border.muted"
            bg={flush ? "transparent" : "bg.subtle"}
            marginBottom={flush ? 0 : 1.5}
            overflow="hidden"
          >
            <CodeBlock.Content
              paddingX={flush ? 2 : 2}
              paddingY={flush ? 1.5 : 1.5}
              css={{
                "& pre, & code": {
                  background: "transparent !important",
                  fontSize: flush ? "0.8em" : "0.78em",
                  lineHeight: "1.55",
                  padding: "0 !important",
                  margin: "0 !important",
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
    </CodeBlock.AdapterProvider>
  );
}
