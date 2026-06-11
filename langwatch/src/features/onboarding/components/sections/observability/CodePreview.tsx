import {
  ClientOnly,
  CodeBlock,
  createShikiAdapter,
  HStack,
  Icon,
  IconButton,
} from "@chakra-ui/react";
import { Check, Copy, Eye, EyeOff, WandSparkles } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import type { HighlighterGeneric } from "shiki";
import { useColorMode } from "../../../../../components/ui/color-mode";
import { toaster } from "../../../../../components/ui/toaster";
import { Tooltip } from "../../../../../components/ui/tooltip";

interface CodePreviewProps {
  code: string;
  filename: string;
  codeLanguage: string;
  highlightLines?: number[];
  languageIconUrl?: string;
  sensitiveValue?: string;
  enableVisibilityToggle?: boolean;
  isVisible?: boolean;
  onToggleVisibility?: () => void;
  llmPrompt?: string;
  /**
   * When true, the header action buttons (copy / eye / llm-prompt) are
   * suppressed. Used by empty-state surfaces where the rendered code
   * still includes a placeholder value (e.g. `sk-lw-xxxxx...`) and
   * letting the user copy it would just create a broken curl that
   * silently fails. The canonical mint CTA lives in the surrounding
   * surface (banner / panel) instead.
   */
  disableActions?: boolean;
}

export function CodePreview({
  code,
  filename,
  codeLanguage: chakraLanguage,
  highlightLines,
  languageIconUrl,
  sensitiveValue,
  enableVisibilityToggle,
  isVisible: controlledIsVisible,
  onToggleVisibility,
  llmPrompt,
  disableActions,
}: CodePreviewProps): React.ReactElement | null {
  const { colorMode } = useColorMode();
  const [internalIsVisible, setInternalIsVisible] = useState(false);

  const isVisible =
    controlledIsVisible !== void 0 ? controlledIsVisible : internalIsVisible;

  const shikiAdapter = useMemo(() => {
    return createShikiAdapter<HighlighterGeneric<any, any>>({
      async load() {
        const { createHighlighter } = await import("shiki");
        return createHighlighter({
          langs: ["typescript", "python", "go", "yaml", "bash", "json"],
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

  async function copyLLMPrompt(): Promise<void> {
    if (!llmPrompt) return;

    try {
      await navigator.clipboard.writeText(llmPrompt);
      toaster.create({
        title: "Copied LLM prompt",
        description: "Integration prompt copied to clipboard",
        type: "success",
        meta: {
          closable: true,
        },
      });
    } catch {
      toaster.create({
        title: "Failed to copy",
        description: "Could not copy to clipboard",
        type: "error",
        meta: {
          closable: true,
        },
      });
    }
  }

  if (!code) return null;

  return (
    <CodeBlock.AdapterProvider value={shikiAdapter}>
      <ClientOnly>
        {() => (
          <CodeBlock.Root
            size="sm"
            colorPalette="orange"
            code={displayCode}
            language={chakraLanguage}
            meta={{ highlightLines, colorScheme: colorMode }}
            transition="all 0.3s ease"
            borderRadius="xl"
            border="1px solid"
            borderColor="border.emphasized"
            bg="bg.panel/60"
            backdropFilter="blur(20px) saturate(1.3)"
            boxShadow="0 4px 30px rgba(0,0,0,0.06)"
            overflow="hidden"
          >
            <CodeBlock.Header display="flex" justifyContent="space-between" borderColor="gray.200">
              <CodeBlock.Title fontSize="xs" pt={2}>
                {languageIconUrl ? (
                  <Icon size="xs">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={languageIconUrl} alt={filename} />
                  </Icon>
                ) : null}
                {filename}
              </CodeBlock.Title>

              <HStack gap="0" mr="-3px">
                {/* `disableActions` is set by empty-state surfaces where
                    the rendered code still includes a placeholder value
                    (e.g. `sk-lw-xxxxx...`). Showing copy / eye / llm
                    prompt would just let the user export a broken
                    snippet — the canonical mint CTA lives in the
                    surrounding banner instead. */}
                {!disableActions && enableVisibilityToggle && (
                  <Tooltip
                    content={
                      isVisible
                        ? "Hide sensitive values"
                        : "Show sensitive values"
                    }
                    openDelay={0}
                    showArrow
                  >
                    <IconButton
                      size="2xs"
                      variant="ghost"
                      onClick={toggleVisibility}
                      aria-label={
                        isVisible
                          ? "Hide sensitive values"
                          : "Show sensitive values"
                      }
                    >
                      {isVisible ? <EyeOff /> : <Eye />}
                    </IconButton>
                  </Tooltip>
                )}
                {!disableActions && llmPrompt && (
                  <Tooltip
                    content="Copy LLM-optimized integration prompt"
                    openDelay={0}
                    showArrow
                  >
                    <IconButton
                      size="2xs"
                      variant="ghost"
                      onClick={() => void copyLLMPrompt()}
                      aria-label="Copy LLM-optimized integration prompt"
                    >
                      <WandSparkles />
                    </IconButton>
                  </Tooltip>
                )}
                {!disableActions && (
                  <CodeBlock.CopyTrigger asChild>
                    <IconButton variant="ghost" size="2xs" aria-label="Copy">
                      <CodeBlock.CopyIndicator copied={<Check size={14} />}>
                        <Copy size={14} />
                      </CodeBlock.CopyIndicator>
                    </IconButton>
                  </CodeBlock.CopyTrigger>
                )}
              </HStack>
            </CodeBlock.Header>
            <CodeBlock.Content
              transition="background-color 0.3s ease, color 0.3s ease"
              css={{
                "& pre, & code": {
                  transition: "background-color 0.3s ease, color 0.3s ease",
                },
              }}
              overflow="scroll"
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
