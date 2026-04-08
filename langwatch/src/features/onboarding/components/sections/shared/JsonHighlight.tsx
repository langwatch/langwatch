import { ClientOnly, CodeBlock, createShikiAdapter } from "@chakra-ui/react";
import type React from "react";
import { useMemo } from "react";
import type { HighlighterGeneric } from "shiki";
import { useColorMode } from "~/components/ui/color-mode";

export function JsonHighlight({
  code,
}: {
  code: string;
}): React.ReactElement {
  const { colorMode } = useColorMode();

  const shikiAdapter = useMemo(
    () =>
      createShikiAdapter<HighlighterGeneric<any, any>>({
        async load() {
          const { createHighlighter } = await import("shiki");
          return createHighlighter({
            langs: ["json"],
            themes: ["github-dark", "github-light"],
          });
        },
        theme: colorMode === "dark" ? "github-dark" : "github-light",
      }),
    [colorMode],
  );

  return (
    <CodeBlock.AdapterProvider value={shikiAdapter}>
      <ClientOnly
        fallback={
          <pre
            style={{
              padding: "16px 48px 16px 20px",
              fontSize: "12.5px",
              fontFamily:
                "'Geist Mono', 'IBM Plex Mono', 'Source Code Pro', Menlo, monospace",
              lineHeight: "1.8",
              overflowX: "hidden",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              letterSpacing: "0.01em",
              fontWeight: "500",
            }}
          >
            {code}
          </pre>
        }
      >
        {() => (
          <CodeBlock.Root
            code={code}
            language="json"
            size="sm"
            bg="transparent"
            border="none"
            borderRadius="0"
          >
            <CodeBlock.Content
              overflowX="hidden"
              css={{
                "& pre": {
                  padding: "16px 48px 16px 20px",
                  fontSize: "12.5px",
                  fontFamily:
                    "'Geist Mono', 'IBM Plex Mono', 'Source Code Pro', Menlo, monospace",
                  lineHeight: "1.8",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  letterSpacing: "0.01em",
                  background: "transparent",
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
