/**
 * A read-only snippet, highlighted and copyable. A web package may not
 * import another web package for its highlighter, so this goes through the
 * Design System's shared Shiki adapter, rendered via Chakra's own
 * `CodeBlock`. Highlighting is lazy by construction: the adapter loads its
 * grammars on first render, so a page that never opens this never downloads
 * them.
 */

import { ClientOnly, CodeBlock, IconButton } from "@chakra-ui/react";
import { useShikiAdapter } from "@langwatch/design-system/shiki";
import { useColorMode } from "@langwatch/design-system/color-mode";

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
