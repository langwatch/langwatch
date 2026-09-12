/**
 * The way to connect an agent from code (ADR-128), opened from the new agent flow.
 * @see specs/features/agents/connected-agents-ui.feature
 */

import {
  Box,
  Button,
  ClientOnly,
  CodeBlock as ChakraCodeBlock,
  HStack,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { useColorMode } from "@langwatch/design-system/color-mode";
import { useShikiAdapter } from "@langwatch/design-system/shiki";
import { Drawer } from "@langwatch/design-system/studio-drawer";
import {
  connectSnippets,
  SNIPPET_LANGUAGE_LABELS,
  SNIPPET_LANGUAGES,
  type SnippetLanguage,
} from "../../model/connect-snippets.ts";

/** The install line of each language, above its snippet. */
const INSTALL_COMMANDS: Record<SnippetLanguage, string> = {
  python: "pip install langwatch",
  typescript: "npm install langwatch zod",
};

export type ConnectFromCodeDrawerProps = {
  open?: boolean;
  onClose(): void;
  onGoBack?: () => void;
  setupButton?: ReactNode;
  renderCopyButton(input: { value: string; label: string }): ReactNode;
};

export function ConnectFromCodeDrawer(props: ConnectFromCodeDrawerProps) {
  const onClose = props.onClose;
  const isOpen = props.open === true;
  const snippets = connectSnippets({});

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="md"
      modal={false}
    >
      <Drawer.Content bg="bg">
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack gap={2}>
            {props.onGoBack && (
              <Button
                variant="ghost"
                size="sm"
                onClick={props.onGoBack}
                padding={1}
                minWidth="auto"
                data-testid="back-button"
              >
                <ArrowLeft size={20} />
              </Button>
            )}
            <Drawer.Title>Connect from code</Drawer.Title>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={5} data-testid="connect-from-code-drawer">
            <HStack justify="space-between" gap={3}>
              <Text fontSize="sm" color="fg.muted">
                Write a small function beside your service startup that calls the agent you already
                have.
              </Text>
              {props.setupButton}
            </HStack>

            <SnippetTabs snippets={snippets} renderCopyButton={props.renderCopyButton} />

            <ListeningIndicator />
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function SnippetTabs({
  snippets,
  renderCopyButton,
}: {
  snippets: Record<(typeof SNIPPET_LANGUAGES)[number], string>;
  renderCopyButton: ConnectFromCodeDrawerProps["renderCopyButton"];
}) {
  // The theme is unresolved for the first render, before the theme provider
  // mounts, and that render paints light rather than a dark block that flips.
  const { colorMode } = useColorMode();
  const codeColorMode = colorMode === "dark" ? "dark" : "light";
  return (
    // Without a colorPalette the line variant paints the selected trigger
    // with the default palette's fg, which reads fainter than the unselected
    // one. Same palette as the integrate drawer's language tabs.
    <Tabs.Root defaultValue="python" variant="line" size="sm" colorPalette="orange">
      <Tabs.List>
        {SNIPPET_LANGUAGES.map((language) => (
          <Tabs.Trigger key={language} value={language}>
            {SNIPPET_LANGUAGE_LABELS[language]}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {SNIPPET_LANGUAGES.map((language) => (
        <Tabs.Content key={language} value={language} paddingTop={3}>
          <VStack align="stretch" gap={2}>
            <CodeBlock
              code={INSTALL_COMMANDS[language]}
              label="Install command"
              language="bash"
              colorMode={codeColorMode}
              renderCopyButton={renderCopyButton}
            />
            <CodeBlock
              code={snippets[language]}
              label="Snippet"
              language={language}
              colorMode={codeColorMode}
              renderCopyButton={renderCopyButton}
            />
          </VStack>
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

/**
 * A highlighted, copyable block. Long lines keep their width and scroll
 * sideways, so the code the reader copies is the code shown.
 */
function CodeBlock({
  code,
  label,
  language,
  colorMode,
  renderCopyButton,
}: {
  code: string;
  label: string;
  language: string;
  colorMode: "light" | "dark";
  renderCopyButton: ConnectFromCodeDrawerProps["renderCopyButton"];
}) {
  const adapter = useShikiAdapter(colorMode);
  return (
    <ChakraCodeBlock.AdapterProvider value={adapter}>
      <ClientOnly>
        {() => (
          <ChakraCodeBlock.Root
            code={code}
            language={language}
            size="sm"
            meta={{ colorScheme: colorMode }}
            borderRadius="md"
            overflow="hidden"
            data-testid={`connect-code-${language}`}
          >
            <ChakraCodeBlock.Content overflowX="auto">
              <ChakraCodeBlock.Code>
                <ChakraCodeBlock.CodeText />
              </ChakraCodeBlock.Code>
            </ChakraCodeBlock.Content>
            <HStack justify="flex-end" paddingX={2} paddingY={1}>
              {renderCopyButton({ value: code, label })}
            </HStack>
          </ChakraCodeBlock.Root>
        )}
      </ClientOnly>
    </ChakraCodeBlock.AdapterProvider>
  );
}

function ListeningIndicator() {
  return (
    <HStack gap={2} data-testid="connect-agent-listening">
      <Box
        boxSize="8px"
        borderRadius="full"
        background="blue.500"
        css={{
          "@keyframes listening-dot": {
            "0%, 100%": { opacity: 1 },
            "50%": { opacity: 0.3 },
          },
        }}
        animation="listening-dot 1.6s ease-in-out infinite"
      />
      <Text fontSize="12px" color="fg.muted">
        Waiting for an agent to connect
      </Text>
    </HStack>
  );
}
