import { Dialog } from "@langwatch/design-system/dialog";
import { Box, Tabs, useDisclosure, VStack } from "@langwatch/design-system/primitives";
import { uppercaseFirstLetter } from "@langwatch/design-system/string-casing";
import React, { createContext, useContext, useMemo, useState } from "react";

import type { Snippet, Target } from "../../api-snippet/openapi-snippet.types.ts";
import { CodePreview } from "../../onboarding/observability/code-preview.tsx";

// Add context for dialog state
const ApiSnippetDialogContext = createContext<{
  open: boolean;
  onOpen: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onClose: () => void;
} | null>(null);

// Update props to accept children for composition
interface GenerateApiSnippetProps {
  snippets: Snippet[];
  targets: Target[];
  title?: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /**
   * Optional extra controls rendered under the header (for example a data-source
   * picker, or a route to create an API key when the snippet has none).
   */
  controls?: React.ReactNode;
  /**
   * A credential the snippet carries. It is masked until the reader reveals it,
   * and the copy button always writes the unmasked snippet so a copy is never a
   * credential that fails only once it is pasted.
   */
  sensitiveValue?: string;
  /**
   * Hides the copy button. Set it when the snippet still carries a placeholder
   * the reader has to replace, so copying it would only produce a call that
   * silently fails.
   */
  copyDisabled?: boolean;
  /**
   * Controlled open state. When provided, the caller owns opening/closing
   * (e.g. a menu item closing its own popover as it opens this dialog) and
   * `Trigger` is not needed; omitted, the dialog manages its own state.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function GenerateApiSnippetDialog({
  snippets,
  targets,
  title,
  description,
  children,
  controls,
  sensitiveValue,
  copyDisabled = false,
  open: openProp,
  onOpenChange,
}: GenerateApiSnippetProps) {
  const disclosure = useDisclosure();
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : disclosure.open;
  const setOpen = (next: boolean) => {
    if (isControlled) {
      onOpenChange?.(next);
      return;
    }
    if (next) disclosure.onOpen();
    else disclosure.onClose();
  };
  const onOpen = () => setOpen(true);
  const onClose = () => setOpen(false);
  const [selectedTarget, setSelectedTarget] = useState<Target>(targets[0] ?? "python_python3");

  // Derived, never synced by an effect: callers rebuild `snippets` each render (React #185).
  const selectedSnippet = useMemo<Snippet | undefined>(
    () => snippets.find((snippet) => snippet.target === selectedTarget) ?? snippets[0],
    [snippets, selectedTarget],
  );

  const handleOpen = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onOpen();
  };

  if (!selectedSnippet) {
    return null;
  }

  const code = selectedSnippet.content;
  const language = SnippetTargetToLanguageMap[selectedSnippet.target];

  return (
    <ApiSnippetDialogContext.Provider value={{ open, onOpen: handleOpen, onClose }}>
      {children}
      <Dialog.Root open={open} onOpenChange={({ open }) => (open ? onOpen() : onClose())} size="lg">
        <Dialog.Content
          bg="bg"
          borderWidth="1px"
          borderColor="border"
          borderRadius="lg"
          boxShadow="lg"
          width={{ base: "calc(100vw - 24px)", md: "calc(100vw - 48px)" }}
          maxWidth="880px"
          maxHeight="calc(100dvh - 48px)"
          overflow="hidden"
        >
          <Dialog.CloseTrigger />
          <Dialog.Header paddingX={6} paddingTop={6} paddingBottom={3} paddingRight={12}>
            <VStack alignItems="flex-start" gap={1} width="100%">
              <Dialog.Title>{title ?? "API Usage"}</Dialog.Title>
              {description ? (
                <Dialog.Description fontSize="sm" color="fg.muted">
                  {description}
                </Dialog.Description>
              ) : null}
            </VStack>
          </Dialog.Header>
          <Dialog.Body paddingX={6} paddingTop={1} paddingBottom={6} overflowY="auto" minHeight={0}>
            <VStack alignItems="stretch" gap={4} width="100%">
              {controls}
              <Box>
                <Tabs.Root
                  value={selectedSnippet.target}
                  onValueChange={({ value }) => {
                    const next = targets.find((target) => target === value);
                    if (next) setSelectedTarget(next);
                  }}
                  variant="line"
                  size="sm"
                >
                  <Tabs.List aria-label="Snippet language">
                    {targets.map((target) => (
                      <Tabs.Trigger key={target} value={target}>
                        {formatTarget(target)}
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>
                </Tabs.Root>
                <CodePreview
                  code={code}
                  filename={fileNameForLanguage(language)}
                  codeLanguage={language}
                  languageIconUrl={languageIconFor(language)}
                  sensitiveValue={sensitiveValue}
                  enableVisibilityToggle={!!sensitiveValue}
                  // Always the unmasked snippet: a masked key fails only once pasted.
                  copyText={code}
                  disableActions={copyDisabled}
                  maxHeight="min(460px, 58dvh)"
                />
              </Box>
            </VStack>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
    </ApiSnippetDialogContext.Provider>
  );
}

// Compound Trigger subcomponent
GenerateApiSnippetDialog.Trigger = function Trigger({
  children,
}: {
  children: React.ReactElement<{ onClick?: React.MouseEventHandler<HTMLButtonElement> }>;
}) {
  const ctx = useContext(ApiSnippetDialogContext);

  if (!ctx) throw new Error("Trigger must be used within GenerateApiSnippetDialog");
  // Clone the child and inject onClick to open the dialog
  return React.cloneElement(children, {
    onClick: ctx.onOpen,
  });
} as React.FC<{ children: React.ReactElement }>;

GenerateApiSnippetDialog.Trigger.displayName = "GenerateApiSnippetDialog.Trigger";

/**
 * What each target is called in the picker. The target id names the transport
 * ("node", "shell"), which is not what the reader is choosing between: they
 * are picking a language, and the name of the tool they will run.
 */
const TARGET_LABELS: Partial<Record<Target, string>> = {
  python_python3: "Python",
  python_requests: "Python",
  node_native: "TypeScript",
  go_native: "Go",
  shell_curl: "cURL",
};

function formatTarget(target: Target) {
  const label = TARGET_LABELS[target];
  if (label) return label;
  const [language, framework] = target.split("_");
  if (!language || !framework) return target;
  return `${uppercaseFirstLetter(language)}`;
}

/**
 * Map of snippet targets to Prism languages. Unsupported targets fall back to
 * the closest match, or bash. Not every target is supported by RenderCode.
 */
const SnippetTargetToLanguageMap: Record<Target, string> = {
  c_libcurl: "bash",
  csharp_restsharp: "bash",
  csharp_httpclient: "bash",
  go_native: "go",
  java_okhttp: "bash",
  java_unirest: "bash",
  javascript_jquery: "javascript",
  javascript_xhr: "javascript",
  node_native: "typescript",
  node_request: "javascript",
  node_unirest: "javascript",
  objc_nsurlsession: "bash",
  ocaml_cohttp: "bash",
  php_curl: "php",
  php_http1: "php",
  php_http2: "php",
  python_python3: "python",
  python_requests: "python",
  ruby_native: "bash",
  shell_curl: "bash",
  shell_httpie: "bash",
  shell_wget: "bash",
  swift_nsurlsession: "bash",
} as const;

/**
 * The file name shown on the code block. A file name reads like a code block
 * header and, unlike the language name, does not repeat what the picker beside
 * it already says.
 */
function fileNameForLanguage(language: string): string {
  switch (language) {
    case "python":
      return "example.py";
    case "typescript":
      return "example.ts";
    case "javascript":
      return "example.js";
    case "go":
      return "main.go";
    case "bash":
    case "shellscript":
      return "example.sh";
    default:
      return "snippet";
  }
}

/**
 * Language mark shown in the code block's title bar. A language we carry no
 * mark for goes without one - borrowing a neighbouring language's logo tells
 * the reader they are looking at a snippet they are not.
 */
function languageIconFor(language: string): string | undefined {
  switch (language) {
    case "python":
      return "/images/external-icons/python.svg";
    case "typescript":
      return "/images/external-icons/typescript.svg";
    case "go":
      return "/images/external-icons/golang.svg";
    default:
      return undefined;
  }
}
