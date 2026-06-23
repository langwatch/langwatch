import { Box, ClientOnly, CodeBlock } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import {
  ensureShikiLangLoaded,
  isShikiLangReady,
  normalizeShikiLang,
} from "./shikiAdapter";

/**
 * Resolve a fence language to a grammar that's actually ready to render.
 * Base languages are ready immediately; any other bundled language is
 * lazy-loaded on first use — we render plain "text" until its grammar
 * resolves, then re-render highlighted. Non-bundled languages stay "text",
 * so Shiki never throws "Language X not found". See
 * dev/docs/adr/027-trace-drawer-code-highlighting.md
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
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canonical]);
  return isShikiLangReady(canonical) ? canonical : "text";
}

/**
 * Single Shiki-backed code block component used everywhere in the drawer.
 * Relies on the ambient `<CodeBlock.AdapterProvider>` mounted at the
 * `TraceV2DrawerShell` root so we don't spin up a per-instance adapter
 * (and a per-instance Highlighter beneath it).
 *
 * The previous `ShikiHighlight` lean variant called `codeToHtml` directly
 * — second pipeline, second cache, no ambient provider. Removed because
 * nothing imported it anyway.
 */
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
          language={lang}
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
                // Bumped from 0.78/0.8em which landed at ~9 px (or
                // as low as ~7 px when nested under a 2xs textStyle
                // parent) — operator minimum is 10 px everywhere.
                // Absolute `0.625rem` pins exactly there regardless of
                // parent textStyle: no em-scaling drift up to 11–12 px
                // in `xs` contexts, no drift down under tighter
                // parents either.
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
