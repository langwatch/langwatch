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
   * project id, endpoint) the user actually has to copy.
   */
  highlightLines?: number[];
}): React.ReactElement {
  const { colorMode } = useColorMode();
  const adapter = useShikiAdapter(colorMode);
  const highlightBg =
    colorMode === "dark"
      ? "rgba(237,137,38,0.18)"
      : "rgba(237,137,38,0.12)";

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
            fontSize="12.5px"
            lineHeight="1.8"
            letterSpacing="0.01em"
            color="fg"
            whiteSpace="pre"
            overflowX="hidden"
          >
            {code}
          </Box>
        }
      >
        {() => (
          <CodeBlock.Root
            size="sm"
            code={code}
            language="json"
            meta={{ colorScheme: colorMode, highlightLines }}
            bg="transparent"
            overflowX="hidden"
            css={{
              "--code-block-highlight-bg": highlightBg,
              "--code-block-highlight-border": "rgba(237,137,38,0.6)",
            }}
          >
            <CodeBlock.Content
              paddingX={5}
              paddingY={4}
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
