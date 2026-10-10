import { Box, ClientOnly, CodeBlock } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useColorMode } from "~/components/ui/color-mode";
import {
  ensureShikiLangLoaded,
  isShikiLangReady,
  normalizeShikiLang,
  useShikiAdapter,
} from "~/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter";

/**
 * The declared media type mapped to the grammar the preview highlights it as,
 * honouring structured suffixes (RFC 6839: `application/soap+xml` is XML).
 * Anything we have no grammar for reads as plain text — the preview adapts to
 * what the author declared, it never forces a shape.
 */
export function highlightLangForContentType(contentType: string): string {
  const media = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  const subtype = media.split("/")[1] ?? "";
  const suffix = subtype.includes("+")
    ? subtype.slice(subtype.lastIndexOf("+") + 1)
    : subtype;
  switch (suffix) {
    case "json":
      return "json";
    case "xml":
      return "xml";
    case "html":
      return "html";
    case "yaml":
    case "x-yaml":
      return "yaml";
    case "javascript":
      return "javascript";
    case "csv":
      return "csv";
    case "markdown":
      return "markdown";
    default:
      return "text";
  }
}

/**
 * The rendered webhook body, syntax-highlighted for the declared Content-Type
 * through the app's shared Shiki highlighter (one singleton engine, grammars
 * lazy-loaded on demand). Until a grammar is ready — or when the type maps to
 * none — the body renders as plain monospace text, so the preview is never
 * blank and never blocked on a grammar download.
 */
export function HighlightedBodyPreview({
  body,
  contentType,
}: {
  body: string;
  contentType: string;
}) {
  const { colorMode } = useColorMode();
  const adapter = useShikiAdapter(colorMode);
  const canonical = normalizeShikiLang(
    highlightLangForContentType(contentType),
  );
  const [, retokenize] = useState(0);
  useEffect(() => {
    if (isShikiLangReady(canonical)) return;
    ensureShikiLangLoaded(canonical)
      .then(() => retokenize((n) => n + 1))
      // A grammar that fails to load is not an error state the reader needs:
      // the preview simply stays on the plain-text fallback below.
      .catch(() => undefined);
  }, [canonical]);
  const language = isShikiLangReady(canonical) ? canonical : "text";

  const plain = (
    <Box
      as="pre"
      textStyle="xs"
      fontFamily="mono"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
      margin={0}
    >
      {body}
    </Box>
  );

  return (
    <ClientOnly fallback={plain}>
      {() => (
        <CodeBlock.AdapterProvider value={adapter}>
          <CodeBlock.Root
            size="sm"
            code={body}
            language={language}
            bg="transparent"
            borderWidth={0}
            borderRadius={0}
            overflow="hidden"
          >
            <CodeBlock.Content paddingX={0} paddingY={0}>
              <CodeBlock.Code
                css={{
                  "& pre, & code": {
                    background: "transparent !important",
                    fontSize: "0.75rem",
                    lineHeight: "1.6",
                    padding: "0 !important",
                    margin: "0 !important",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  },
                }}
              >
                <CodeBlock.CodeText />
              </CodeBlock.Code>
            </CodeBlock.Content>
          </CodeBlock.Root>
        </CodeBlock.AdapterProvider>
      )}
    </ClientOnly>
  );
}
