/**
 * A read-only snippet, highlighted and copyable through the Design
 * System's shared Shiki adapter (a web package may not import another for
 * its highlighter). Lazy by construction: grammars load on first render.
 */

import { ClientOnly, CodeBlock, IconButton } from "@chakra-ui/react";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { useShikiAdapter } from "@langwatch/design-system/shiki";

export function CodeSnippet({ code, language }: { code: string; language: string }) {
  const { colorMode } = useColorMode();
  const adapter = useShikiAdapter(colorMode);

  return (
    <CodeBlock.AdapterProvider value={adapter}>
      <ClientOnly>
        {() => (
          <CodeBlock.Root
            code={code}
            language={language}
            size="sm"
            meta={{ colorScheme: colorMode }}
            borderRadius="md"
            overflow="hidden"
          >
            <CodeBlock.Content>
              <CodeBlock.Code>
                <CodeBlock.CodeText />
              </CodeBlock.Code>
              <CodeBlock.CopyTrigger asChild>
                <IconButton variant="ghost" size="2xs" aria-label="Copy snippet">
                  <CodeBlock.CopyIndicator />
                </IconButton>
              </CodeBlock.CopyTrigger>
            </CodeBlock.Content>
          </CodeBlock.Root>
        )}
      </ClientOnly>
    </CodeBlock.AdapterProvider>
  );
}
