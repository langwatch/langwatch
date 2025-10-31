import React, { useMemo, useState } from "react";
import { CodeBlock, createShikiAdapter, Icon, IconButton, HStack } from "@chakra-ui/react";
import type { HighlighterGeneric } from "shiki";
import { useColorMode } from "../../../../../components/ui/color-mode";
import { Eye, EyeOff } from "lucide-react";
import { Tooltip } from "../../../../../components/ui/tooltip";

interface CodePreviewProps {
  code: string;
  filename: string;
  codeLanguage: string;
  highlightLines?: number[];
  languageIcon?: React.ReactNode;
  sensitiveValue?: string;
  enableVisibilityToggle?: boolean;
  isVisible?: boolean;
  onToggleVisibility?: () => void;
}

export function CodePreview({ code, filename, codeLanguage: chakraLanguage, highlightLines, languageIcon, sensitiveValue, enableVisibilityToggle, isVisible: controlledIsVisible, onToggleVisibility }: CodePreviewProps): React.ReactElement | null {
  const { colorMode } = useColorMode();
  const [internalIsVisible, setInternalIsVisible] = useState(false);

  const isVisible = controlledIsVisible !== void 0 ? controlledIsVisible : internalIsVisible;

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

  const displayCode = useMemo(() => {
    if (!sensitiveValue || isVisible || !code.includes(sensitiveValue)) {
      return code;
    }

    const prefix = sensitiveValue.slice(0, 4);
    const suffix = sensitiveValue.slice(-3);
    const maskedValue = `${prefix}***...***${suffix}`;

    return code.replaceAll(sensitiveValue, maskedValue);
  }, [code, sensitiveValue, isVisible]);

  function toggleVisibility(): void {
    if (onToggleVisibility) {
      onToggleVisibility();
    } else {
      setInternalIsVisible((prev) => !prev);
    }
  }

  if (!code) return null;

  return (
    <CodeBlock.AdapterProvider value={shikiAdapter}>
      <CodeBlock.Root
        size="sm"
        code={displayCode}
        language={chakraLanguage}
        meta={{ highlightLines }}
        transition="all 0.3s ease"
      >
        <CodeBlock.Header display="flex" justifyContent="space-between">
          <CodeBlock.Title fontSize="xs" pt={2}>
            {languageIcon ? <Icon size="xs">{languageIcon}</Icon> : null}
            {filename}
          </CodeBlock.Title>

          <HStack gap="0" mr="-3px">
            {enableVisibilityToggle && (
              <Tooltip content={isVisible ? "Hide sensitive values" : "Show sensitive values"} openDelay={0} showArrow>
                <IconButton
                  size="2xs"
                  variant="ghost"
                  onClick={toggleVisibility}
                  aria-label={isVisible ? "Hide sensitive values" : "Show sensitive values"}
                >
                  {isVisible ? <EyeOff /> : <Eye />}
                </IconButton>
              </Tooltip>
            )}
            <CodeBlock.CopyTrigger asChild>
              <IconButton variant="ghost" size="2xs">
                <CodeBlock.CopyIndicator copied={code} />
              </IconButton>
            </CodeBlock.CopyTrigger>
          </HStack>
        </CodeBlock.Header>
        <CodeBlock.Content
          transition="background-color 0.3s ease, color 0.3s ease"
          css={{
            '& pre, & code': {
              transition: 'background-color 0.3s ease, color 0.3s ease',
            },
          }}
          overflow="scroll"
        >
          <CodeBlock.Code>
            <CodeBlock.CodeText />
          </CodeBlock.Code>
        </CodeBlock.Content>
      </CodeBlock.Root>
    </CodeBlock.AdapterProvider>
  );
}
