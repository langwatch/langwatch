import { Button, HStack, IconButton, Portal, VStack } from "@chakra-ui/react";
import { Dialog } from "../components/ui/dialog";
import { Menu } from "../components/ui/menu";
import { useDisclosure } from "@chakra-ui/react";
import React, { useState } from "react";
import { ChevronDownIcon, CheckIcon, UnplugIcon } from "lucide-react";
import { RenderCode } from "./code/RenderCode";
import type { PrismLanguage } from "@react-email/components";
import type {
  Snippet,
  Target,
} from "../prompt-configs/utils/generatePromptApiSnippet";

interface GenerateApiSnippetButtonProps {
  snippets: Snippet[];
  targets: Target[];
}

/**
 * GeneratePromptApiSnippetButton
 *
 * Renders an icon-only button that, when clicked, opens a modal (Dialog)
 * for displaying API code snippets for prompt usage.
 *
 * - SRP: This component only handles the button and modal UI.
 * - The actual code snippet generation logic will be injected later.
 * - Uses Chakra v3 and react-feather icons as per project rules.
 */
export function GenerateApiSnippetButton({
  snippets,
  targets,
}: GenerateApiSnippetButtonProps) {
  // Chakra v3's useDisclosure for modal open/close state
  const { open, onOpen, onClose } = useDisclosure();
  const [selectedTarget, setSelectedTarget] = useState<Target>("shell_curl");
  const [selectedSnippet, setSelectedSnippet] = useState<Snippet | undefined>(
    snippets[0]
  );

  const handleSetTarget = (target: Target) => {
    setSelectedTarget(target);
    const language = SnippetTargetToPrismLanguageMap[target];

    const snippet = snippets.find(
      (snippet) => SnippetTargetToPrismLanguageMap[snippet.target] === language
    );

    if (snippet) {
      setSelectedSnippet(snippet);
    }
  };

  console.log(selectedSnippet, snippets);
  if (!selectedSnippet) {
    return null;
  }

  return (
    <>
      {/* Icon-only button to trigger the modal */}
      <IconButton
        aria-label="Show API code snippet"
        onClick={onOpen}
        children={<UnplugIcon />}
        size="sm"
        variant="outline"
      />

      {/* Modal (Dialog) for showing code snippets */}
      <Dialog.Root
        open={open}
        onOpenChange={({ open }) => (open ? onOpen() : onClose())}
      >
        <Dialog.Backdrop />
        <Dialog.Content>
          <Dialog.CloseTrigger />
          <Dialog.Header width="100%" marginTop={4}>
            <HStack justifyContent="space-between" width="100%">
              <Dialog.Title>API Usage Code</Dialog.Title>
              <LanguageMenu
                selectedTarget={selectedTarget}
                setSelectedTarget={handleSetTarget}
                targets={targets}
              />
            </HStack>
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
          <Dialog.Footer>
            {/* Placeholder for future copy button(s) */}
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}

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
          {selectedTarget}
          <ChevronDownIcon />
        </Button>
      </Menu.Trigger>
      <Menu.Content zIndex="popover">
        {targets.map((target) => (
          <Menu.Item
            value={target}
            onClick={() => setSelectedTarget(target as Target)}
          >
            {target}
            {selectedTarget === target && <CheckIcon />}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
});

const SnippetTargetToPrismLanguageMap: Record<Target, PrismLanguage> = {
  c_libcurl: "c",
  csharp_restsharp: "csharp",
  csharp_httpclient: "csharp",
  go_native: "go",
  java_okhttp: "java",
  java_unirest: "java",
  javascript_jquery: "javascript",
  javascript_xhr: "javascript",
  node_native: "javascript",
  node_request: "javascript",
  node_unirest: "javascript",
  objc_nsurlsession: "objectivec",
  ocaml_cohttp: "ocaml",
  php_curl: "php",
  php_http1: "php",
  php_http2: "php",
  python_python3: "python",
  python_requests: "python",
  ruby_native: "ruby",
  shell_curl: "bash",
  shell_httpie: "bash",
  shell_wget: "bash",
  swift_nsurlsession: "swift",
} as const;
