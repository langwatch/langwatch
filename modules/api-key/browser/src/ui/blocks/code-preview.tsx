// Highlighted snippet with masked credential. Narrowed family-local copy (onboarding keeps
// theirs). Uses shared shiki highlighter; copyText bypasses CodeBlock copy (security property).
// Spec: token-created-uniform.integration.test.tsx

import { ClientOnly, CodeBlock, HStack, IconButton } from "@chakra-ui/react";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { useShikiAdapter } from "@langwatch/design-system/shiki";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Eye, EyeOff } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { InlineCopyButton } from "../elements/inline-copy-button.tsx";

interface CodePreviewProps {
  code: string;
  filename: string;
  codeLanguage: string;
  /**
   * The value to hide behind a mask until the reader asks to see it. What is
   * COPIED is always {@link copyText}, never the masked form.
   */
  sensitiveValue?: string;
  enableVisibilityToggle?: boolean;
  /**
   * What the copy button writes, regardless of reveal state. Surfaces whose
   * snippet carries a secret pass the real text here.
   */
  copyText?: string;
}

export function CodePreview({
  code,
  filename,
  codeLanguage: chakraLanguage,
  sensitiveValue,
  enableVisibilityToggle,
  copyText,
}: CodePreviewProps): React.ReactElement | null {
  const { colorMode } = useColorMode();
  const [isVisible, setIsVisible] = useState(false);
  const shikiAdapter = useShikiAdapter(colorMode);

  const displayCode = useMemo(() => {
    if (!sensitiveValue || isVisible || !code.includes(sensitiveValue)) {
      return code;
    }

    const prefix = sensitiveValue.slice(0, 4);
    const suffix = sensitiveValue.slice(-3);
    const maskedValue = `${prefix}***...***${suffix}`;

    return code.replaceAll(sensitiveValue, maskedValue);
  }, [code, sensitiveValue, isVisible]);

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
            meta={{ colorScheme: colorMode }}
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
                {filename}
              </CodeBlock.Title>

              <HStack gap="0" mr="-3px">
                {enableVisibilityToggle && (
                  <Tooltip
                    content={isVisible ? "Hide sensitive values" : "Show sensitive values"}
                    openDelay={0}
                    showArrow
                  >
                    <IconButton
                      size="2xs"
                      variant="ghost"
                      onClick={() => setIsVisible((previous) => !previous)}
                      aria-label={isVisible ? "Hide sensitive values" : "Show sensitive values"}
                    >
                      {isVisible ? <EyeOff /> : <Eye />}
                    </IconButton>
                  </Tooltip>
                )}
                <InlineCopyButton text={copyText ?? code} label={filename} />
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
