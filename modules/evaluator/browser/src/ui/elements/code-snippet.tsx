/**
 * A read-only highlighted and copyable snippet. Exists because platform/app cannot
 * import trace-web per web package isolation rules; instead uses the Design System's Shiki
 * adapter. Highlighting is lazy-loaded for performance.
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
