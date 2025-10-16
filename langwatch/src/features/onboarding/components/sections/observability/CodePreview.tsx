import React from "react";
import { CodeBlock, createShikiAdapter, Float, Icon, IconButton } from "@chakra-ui/react";
import type { HighlighterGeneric } from "shiki";

interface CodePreviewProps {
  code: string;
  filename: string;
  codeLanguage: string;
  highlightLines?: number[];
  languageIcon?: React.ReactNode;
}

const shikiAdapter = createShikiAdapter<HighlighterGeneric<any, any>>({
  async load() {
    const { createHighlighter } = await import("shiki");
    return createHighlighter({
      langs: ["typescript", "python", "go", "yaml"],
      themes: ["github-dark", "github-light"],
    });
  },
  theme: "github-dark",
});

export function CodePreview({ code, filename, codeLanguage: chakraLanguage, highlightLines, languageIcon }: CodePreviewProps): React.ReactElement | null {
  if (!code) return null;
  return (
    <CodeBlock.AdapterProvider value={shikiAdapter}>
      <CodeBlock.Root size="sm" code={code} language={chakraLanguage} meta={{ highlightLines }}>
        <CodeBlock.Header>
          <CodeBlock.Title>
            {languageIcon ? <Icon size="sm">{languageIcon}</Icon> : null}
            {filename}
          </CodeBlock.Title>
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
  );
}
