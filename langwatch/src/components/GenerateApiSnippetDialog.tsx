import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useDisclosure } from "@chakra-ui/react";
import type { PrismLanguage } from "@react-email/components";
import { ChevronDownIcon, CheckIcon } from "lucide-react";
import React, { useEffect, useState, createContext, useContext } from "react";

import type { Snippet, Target } from "../prompt-configs/types";

import { RenderCode } from "./code/RenderCode";
import { Dialog } from "./ui/dialog";
import { Menu } from "./ui/menu";

import { uppercaseFirstLetter } from "~/utils/stringCasing";

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
}: GenerateApiSnippetProps) {
  const { open, onOpen, onClose } = useDisclosure();
  const [selectedTarget, setSelectedTarget] =
    useState<Target>("python_python3");
  const [selectedSnippet, setSelectedSnippet] = useState<Snippet | undefined>(
    snippets[0]
  );

  const handleOpen = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onOpen();
  };

  useEffect(() => {
    if (!selectedTarget) return;
    const snippet = snippets.find(
      (snippet) => snippet.target === selectedTarget
    );
    if (snippet) {
      setSelectedSnippet(snippet);
    }
  }, [snippets, selectedTarget]);

  if (!selectedSnippet) {
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
        <Dialog.Backdrop />
        <Dialog.Content>
          <Dialog.CloseTrigger />
          <Dialog.Header width="100%" marginTop={4}>
            <HStack justifyContent="space-between" width="100%">
              <Dialog.Title>{title ?? "API Usage"}</Dialog.Title>
              <LanguageMenu
                selectedTarget={selectedTarget}
                setSelectedTarget={setSelectedTarget}
                targets={targets}
              />
            </HStack>
            <Dialog.Description>
              <VStack alignItems="flex-start" gap={2}>
                {description}
                <HStack>
                  <Text
                    fontSize="sm"
                    color="green.500"
                    backgroundColor="gray.100"
                    paddingX={2}
                    paddingY={1}
                    borderRadius={5}
                  >
                    {selectedSnippet.method}
                  </Text>
                  <Text
                    fontSize="sm"
                    color="gray.500"
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    {selectedSnippet.path}
                  </Text>
                </HStack>
              </VStack>
            </Dialog.Description>
          </Dialog.Header>
          <Dialog.Body>
            <RenderCode
              code={selectedSnippet.content}
              language={SnippetTargetToPrismLanguageMap[selectedTarget]}
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
      <Menu.Content zIndex="popover">
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
