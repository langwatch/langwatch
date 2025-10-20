import React, { useMemo } from "react";
import { CodeBlock, createShikiAdapter, Float, Icon, IconButton } from "@chakra-ui/react";
import type { HighlighterGeneric } from "shiki";
import { useColorMode } from "../../../../../components/ui/color-mode";

interface CodePreviewProps {
  code: string;
  filename: string;
  codeLanguage: string;
  highlightLines?: number[];
  languageIcon?: React.ReactNode;
}

export function CodePreview({ code, filename, codeLanguage: chakraLanguage, highlightLines, languageIcon }: CodePreviewProps): React.ReactElement | null {
  const { colorMode } = useColorMode();

  const shikiAdapter = useMemo(() => {
    return createShikiAdapter<HighlighterGeneric<any, any>>({
      async load() {
        const { createHighlighter } = await import("shiki");
        return createHighlighter({
          langs: ["typescript", "python", "go", "yaml", "bash"],
          themes: ["github-dark", "github-light"],
        });
      },
      theme: colorMode === "dark" ? "github-dark" : "github-light",
    });
  }, [colorMode]);

  if (!code) return null;

  return (
    <CodeBlock.AdapterProvider value={shikiAdapter}>
      <CodeBlock.Root
        size="sm"
        code={code}
        language={chakraLanguage}
        meta={{ highlightLines }}
        transition="all 0.3s ease"
      >
        <CodeBlock.Header>
          <CodeBlock.Title fontSize="xs" pt={2}>
            {languageIcon ? <Icon size="xs">{languageIcon}</Icon> : null}
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
        <CodeBlock.Content
          transition="background-color 0.3s ease, color 0.3s ease"
          css={{
            '& pre, & code': {
              transition: 'background-color 0.3s ease, color 0.3s ease',
            },
          }}
        >
          <CodeBlock.Code>
            <CodeBlock.CodeText />
          </CodeBlock.Code>
        </CodeBlock.Content>
      </CodeBlock.Root>
    </CodeBlock.AdapterProvider>
  );
}
