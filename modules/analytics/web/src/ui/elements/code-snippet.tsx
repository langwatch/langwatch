/**
 * A read-only snippet, highlighted and copyable.
 *
 * `platform/app`'s `components/code/RenderCode` reached `@langwatch/trace-web`
 * for its highlighter, and a web package may not import another web package.
 * The Design System publishes the same Shiki adapter the trace drawer uses, and
 * Chakra's own `CodeBlock` is what renders it — the gateway family's usage
 * snippet is the same shape, reached the same way.
 *
 * Highlighting is LAZY by construction: the adapter loads its grammars on first
 * render, so a page that never opens this dialog never downloads them.
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
