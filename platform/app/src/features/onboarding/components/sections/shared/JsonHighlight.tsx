import { Box, ClientOnly, CodeBlock } from "@chakra-ui/react";
import type React from "react";
import { useColorMode } from "~/components/ui/color-mode";
import { useShikiAdapter } from "~/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter";

export function JsonHighlight({
  code,
  highlightLines,
}: {
  code: string;
  /**
   * 1-indexed line numbers to call out with a background tint. Used by
   * the empty-state onboarding to flag the env-var lines (API key,
   * project id, endpoint) the user actually has to copy. Highlight
   * styling itself comes from the global rule in `pages/_app.tsx`
   * (`[data-line][data-highlight]:after`) so every code block in the
   * app shares the same orange accent.
   */
  highlightLines?: number[];
}): React.ReactElement {
  const { colorMode } = useColorMode();
  const adapter = useShikiAdapter(colorMode);

  return (
    <CodeBlock.AdapterProvider value={adapter}>
      <ClientOnly
        fallback={
          <Box
            as="pre"
            margin={0}
            px={5}
            py={4}
            pr={12}
            fontFamily="'Geist Mono', 'IBM Plex Mono', 'Source Code Pro', Menlo, monospace"
            textStyle="sm"
            lineHeight="1.8"
            letterSpacing="0.01em"
            color="fg"
            whiteSpace="pre"
            overflowX="auto"
          >
            {code}
          </Box>
        }
      >
        {() => (
          <CodeBlock.Root
            size="sm"
            colorPalette="orange"
            code={code}
            language="json"
            meta={{ colorScheme: colorMode, highlightLines }}
            bg="transparent"
            // MCP configs carry long absolute paths and arg arrays — without
            // horizontal scroll, lines past the container width clipped
            // silently because `whiteSpace: pre` keeps everything on one
            // line. `auto` reveals a scrollbar only when needed.
            overflowX="auto"
          >
            <CodeBlock.Content
              paddingY={4}
              paddingLeft={5}
              // 48px right keeps a gutter for the floating Copy button so
              // it doesn't sit on top of the last code column when the
              // block happens to be exactly container-wide.
              paddingRight={12}
              css={{
                "& pre, & code": {
                  background: "transparent !important",
                  fontFamily:
                    "'Geist Mono', 'IBM Plex Mono', 'Source Code Pro', Menlo, monospace",
                  fontSize: "12.5px",
                  lineHeight: "1.8",
                  letterSpacing: "0.01em",
                  margin: "0 !important",
                  padding: "0 !important",
                  whiteSpace: "pre",
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
