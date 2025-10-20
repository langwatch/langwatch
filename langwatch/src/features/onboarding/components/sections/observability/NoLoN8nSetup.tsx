import React from "react";
import { Card, VStack, Text, CodeBlock, Float, IconButton, createShikiAdapter } from "@chakra-ui/react";
import type { HighlighterGeneric } from "shiki";
import { useColorMode } from "../../../../../components/ui/color-mode";
import bashSnippet from "./codegen/snippets/noandlo/n8n.snippet.sh";

export function NoLoN8nSetup(): React.ReactElement {
  const { colorMode } = useColorMode();

  const shikiAdapter = React.useMemo(() => {
    return createShikiAdapter<HighlighterGeneric<any, any>>({
      async load() {
        const { createHighlighter } = await import("shiki");
        return createHighlighter({ langs: ["bash"], themes: ["github-dark", "github-light"] });
      },
      theme: colorMode === "dark" ? "github-dark" : "github-light",
    });
  }, [colorMode]);

  return (
    <Card.Root>
      <Card.Header>
        <Text fontWeight="semibold">n8n setup</Text>
      </Card.Header>
      <Card.Body>
        <VStack align="stretch" gap={3}>
          <Text fontSize="sm">Install the LangWatch n8n nodes, set environment variables, and restart n8n.</Text>
          <CodeBlock.AdapterProvider value={shikiAdapter}>
            <CodeBlock.Root code={bashSnippet} language="bash" size="sm">
              <CodeBlock.Header>
                <CodeBlock.Title>n8n install and configure</CodeBlock.Title>
                <Float placement="top-end" offset="5" zIndex="1">
                  <CodeBlock.CopyTrigger asChild>
                    <IconButton variant="ghost" size="2xs">
                      <CodeBlock.CopyIndicator />
                    </IconButton>
                  </CodeBlock.CopyTrigger>
                </Float>
              </CodeBlock.Header>
              <CodeBlock.Content>
                <CodeBlock.Code>
                  <CodeBlock.CodeText />
                </CodeBlock.Code>
              </CodeBlock.Content>
            </CodeBlock.Root>
          </CodeBlock.AdapterProvider>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}


