import { Box, ClientOnly, CodeBlock } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import {
  ensureShikiLangLoaded,
  isShikiLangReady,
  normalizeShikiLang,
} from "@langwatch/design-system/shiki";

/**
 * Resolve a fence language to a grammar that's actually ready to render. Base languages
 * are ready immediately; any other bundled language is lazy-loaded on first use — we
 * render plain "text" until its grammar resolves, then re-render highlighted.
 */
function useResolvedShikiLang(language: string): string {
  const canonical = normalizeShikiLang(language);
  const [, bump] = useState(0);
  useEffect(() => {
    if (isShikiLangReady(canonical)) {
      return;
    }
    let cancelled = false;
    // Swallow grammar-load failures (network, bad lang id) — the
    // render falls back to "text" via `isShikiLangReady` so the UI
    // stays safe; the unhandled rejection just spams the console.
    void ensureShikiLangLoaded(canonical)
      .then(() => {
        if (!cancelled) bump((x) => x + 1);
      })
      .catch(() => {
        // Intentionally swallowed — see comment above.
      });
    return () => {
      cancelled = true;
    };
  }, [canonical]);
  return isShikiLangReady(canonical) ? canonical : "text";
}

/**
 * Single Shiki-backed code block component used everywhere in the drawer. Relies on the
 * ambient `<CodeBlock.AdapterProvider>` mounted at the `TraceV2DrawerShell` root so we
 * don't spin up a per-instance adapter (and a per-instance Highlighter beneath it).
 */
const FLUSH_FRAME = { borderRadius: 0, borderWidth: 0, bg: "transparent" } as const;
const FRAMED_FRAME = { borderRadius: "md", borderWidth: "1px", bg: "bg.subtle" } as const;

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
  // Resolve to a grammar that's ready now (lazy-loading non-base languages
  // on demand); renders plain "text" until ready / for unbundled languages.
  const lang = useResolvedShikiLang(language);
  const frame = flush ? FLUSH_FRAME : FRAMED_FRAME;
  return (
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
          {...frame}
          borderColor="border.muted"
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
          language={lang}
          meta={{ colorScheme: colorMode }}
          {...frame}
          borderColor="border.muted"
          marginBottom={flush ? 0 : 1.5}
          overflow="hidden"
        >
          <CodeBlock.Content
            paddingX={2}
            paddingY={1.5}
            css={{
              "& pre, & code": {
                background: "transparent !important",
                // Bumped from 0.78/0.8em which landed at ~9 px (or as low as ~7 px when
                // nested under a 2xs textStyle parent) — operator minimum is 10 px
                // everywhere.
                fontSize: "0.625rem",
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
  );
}
