import { Box, ClientOnly, CodeBlock } from "@chakra-ui/react";

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
  );
}
