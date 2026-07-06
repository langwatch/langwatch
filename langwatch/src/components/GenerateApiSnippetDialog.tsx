import { Button, HStack, Text, useDisclosure, VStack } from "@chakra-ui/react";
import type { PrismLanguage } from "@react-email/components";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import React, { createContext, useContext, useEffect, useState } from "react";

import type { Snippet, Target } from "~/prompts/types";
import { uppercaseFirstLetter } from "~/utils/stringCasing";
import { RenderCode } from "./code/RenderCode";
import { Dialog } from "./ui/dialog";
import { Menu } from "./ui/menu";
import { SegmentedControl } from "./ui/segmented-control";

/**
 * A language tab for the segmented language picker. When `tabs` is provided the
 * dialog renders a SegmentedControl instead of the language dropdown, and the
 * caller owns snippet generation. Tabs render in the order given (Python first,
 * then TypeScript, then Shell).
 */
export interface ApiSnippetTab {
  /** Stable value, e.g. "python". */
  value: string;
  /** Human-readable label shown in the segmented control. */
  label: string;
  /** The snippet body to render for this language. */
  content: string;
  /** Prism language id used to highlight the snippet. */
  language: PrismLanguage;
}

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
   * Optional language tabs. When provided, the dialog renders a segmented
   * language picker (in the order given) and shows the selected tab's snippet,
   * bypassing the `snippets` / `targets` dropdown. Existing call sites that omit
   * `tabs` keep the dropdown behavior unchanged.
   */
  tabs?: ApiSnippetTab[];
  /**
   * Optional extra controls rendered under the header (for example a data-source
   * picker). Only rendered when `tabs` is provided.
   */
  controls?: React.ReactNode;
  /**
   * Controlled open state. When provided, the caller owns opening and closing
   * the dialog (for example a menu item that closes its own popover as it opens
   * the dialog) and the internal `Trigger` is not needed. When omitted, the
   * dialog manages its own open state and is opened via `Trigger`.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * GeneratePromptApiSnippetDialog
 *
 * Renders an icon-only button that, when clicked, opens a modal (Dialog)
 * for displaying API code snippets for prompt usage.
 *
 * - SRP: This component only handles the button and modal UI.
 * - The actual code snippet generation logic will be injected later.
 * - Uses Chakra v3 and react-feather icons as per project rules.
 */
export function GenerateApiSnippetDialog({
  snippets,
  targets,
  title,
  description,
  children,
  tabs,
  controls,
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
  const [selectedTarget, setSelectedTarget] = useState<Target>(
    targets[0] ?? "python_python3",
  );
  const [selectedSnippet, setSelectedSnippet] = useState<Snippet | undefined>(
    snippets[0],
  );
  const [selectedTab, setSelectedTab] = useState<string>(
    tabs?.[0]?.value ?? "python",
  );

  const handleOpen = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onOpen();
  };

  useEffect(() => {
    if (!selectedTarget) return;
    const snippet = snippets.find(
      (snippet) => snippet.target === selectedTarget,
    );
    if (snippet) {
      setSelectedSnippet(snippet);
    }
  }, [snippets, selectedTarget]);

  const useTabs = !!tabs && tabs.length > 0;
  const activeTab = useTabs
    ? (tabs.find((tab) => tab.value === selectedTab) ?? tabs[0])
    : undefined;

  if (!useTabs && !selectedSnippet) {
    return null;
  }

  return (
    <ApiSnippetDialogContext.Provider
      value={{ open, onOpen: handleOpen, onClose }}
    >
      {children}
      <Dialog.Root
        open={open}
        onOpenChange={({ open }) => (open ? onOpen() : onClose())}
        size="xl"
      >
        <Dialog.Content bg="bg">
          <Dialog.CloseTrigger />
          <Dialog.Header width="100%" marginTop={4}>
            <VStack alignItems="stretch" gap={3} width="100%">
              <HStack
                justifyContent="space-between"
                width="100%"
                alignItems="flex-start"
              >
                <VStack alignItems="flex-start" gap={2}>
                  <Dialog.Title>{title ?? "API Usage"}</Dialog.Title>
                  <Dialog.Description>{description}</Dialog.Description>
                </VStack>
                {useTabs ? (
                  <SegmentedControl
                    size="sm"
                    value={selectedTab}
                    onValueChange={({ value }) => {
                      if (value) setSelectedTab(value);
                    }}
                    items={tabs!.map((tab) => ({
                      value: tab.value,
                      label: tab.label,
                    }))}
                  />
                ) : (
                  <LanguageMenu
                    selectedTarget={selectedTarget}
                    setSelectedTarget={setSelectedTarget}
                    targets={targets}
                  />
                )}
              </HStack>
              {useTabs && controls ? <HStack>{controls}</HStack> : null}
            </VStack>
          </Dialog.Header>
          <Dialog.Body>
            <RenderCode
              code={
                useTabs
                  ? (activeTab?.content ?? "")
                  : (selectedSnippet?.content ?? "")
              }
              language={
                useTabs
                  ? (activeTab?.language ?? "bash")
                  : SnippetTargetToPrismLanguageMap[selectedTarget]
              }
              style={{
                fontSize: "12px",
                lineHeight: "1.5",
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                padding: "20px",
                borderRadius: "5px",
              }}
            />
          </Dialog.Body>
          <Dialog.Footer></Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </ApiSnippetDialogContext.Provider>
  );
}

// Compound Trigger subcomponent
GenerateApiSnippetDialog.Trigger = function Trigger({
  children,
}: {
  children: React.ReactElement;
}) {
  const ctx = useContext(ApiSnippetDialogContext);

  if (!ctx)
    throw new Error("Trigger must be used within GenerateApiSnippetDialog");
  // Clone the child and inject onClick to open the dialog
  return React.cloneElement(children as React.ReactElement<any>, {
    onClick: ctx.onOpen,
  });
} as React.FC<{ children: React.ReactElement }>;

GenerateApiSnippetDialog.Trigger.displayName =
  "GenerateApiSnippetDialog.Trigger";

const LanguageMenu = React.memo(function LanguageMenu({
  selectedTarget,
  setSelectedTarget,
  targets,
}: {
  selectedTarget: Target;
  setSelectedTarget: (target: Target) => void;
  targets: Target[];
}) {
  const { open, onOpen, onClose } = useDisclosure();

  return (
    <Menu.Root
      open={open}
      onOpenChange={({ open }) => (open ? onOpen() : onClose())}
    >
      <Menu.Trigger asChild>
        <Button aria-label="Select language" size="sm" variant="outline">
          {formatTarget(selectedTarget)}
          <ChevronDownIcon />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        {targets.map((target) => (
          <Menu.Item
            key={target}
            value={target}
            onClick={() => setSelectedTarget(target)}
          >
            {formatTarget(target)}
            {selectedTarget === target && <CheckIcon />}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
});

function formatTarget(target: Target) {
  const [language, framework] = target.split("_");
  if (!language || !framework) return target;
  return `${uppercaseFirstLetter(language)}`;
}

/**
 * Map of snippet targets to Prism languages.
 *
 * If a target is not supported by our Prism implementation, we use closest (or bash)
 *
 * NOTE: Note all targets are supported by the RenderCode component.
 */
const SnippetTargetToPrismLanguageMap: Record<Target, PrismLanguage> = {
  c_libcurl: "bash",
  csharp_restsharp: "bash",
  csharp_httpclient: "bash",
  go_native: "go",
  java_okhttp: "bash",
  java_unirest: "bash",
  javascript_jquery: "javascript",
  javascript_xhr: "javascript",
  node_native: "javascript",
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
