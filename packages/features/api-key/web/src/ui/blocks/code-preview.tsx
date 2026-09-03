/**
 * A snippet, highlighted, with the credential in it masked until asked for.
 *
 * A NARROWED FAMILY-LOCAL COPY of
 * `platform/app/src/features/onboarding/components/sections/observability/CodePreview.tsx`,
 * which stays: seven other onboarding surfaces render it. Three things changed,
 * and all three are worth naming:
 *
 *  1. **The highlighter is the shared one.** The platform component built its
 *     own Shiki adapter around an inline `await import("shiki")` — a lazy import
 *     the repo bans outside the CLI boot path, and a second Oniguruma engine
 *     besides. `@langwatch/design-system/shiki` already owns a singleton
 *     highlighter whose eager language set lists `ini` FOR THIS DIALOG, and
 *     `bash` covers `shellscript` because shiki registers the two as one grammar
 *     with `bash` as an alias. `token-created-snippets.unit.test.ts` asserts
 *     every language this dialog names resolves inside that eager set, which is
 *     a stronger guard than the substring match on a source file it replaces.
 *  2. **The `llmPrompt` action did not travel.** It is the only thing in the
 *     platform component that reached the toast singleton, no API-keys surface
 *     ever passed it, and the onboarding screens that do keep their own copy.
 *     `languageIconUrl`, `highlightLines`, `disableActions` and the controlled
 *     visibility pair went with it for the same reason: this family passes none
 *     of them.
 *  3. **`copyText` still bypasses the CodeBlock copy path.** That trigger copies
 *     whatever string is RENDERED, which is the masked form while a sensitive
 *     snippet is hidden — a credential that fails only when pasted. It is the
 *     one behaviour in this component that is a security property rather than a
 *     nicety, and `token-created-uniform.integration.test.tsx` pins it.
 */

import { ClientOnly, CodeBlock, HStack, IconButton } from "@chakra-ui/react";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { useShikiAdapter } from "@langwatch/design-system/shiki";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Eye, EyeOff } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { InlineCopyButton } from "../elements/inline-copy-button";

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
