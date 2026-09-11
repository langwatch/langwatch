/**
 * The way to connect an agent from code (ADR-128), opened from the new agent flow.
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { Box, Button, HStack, Tabs, Text, VStack } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

<<<<<<< HEAD:modules/agent/web/src/ui/sections/connect-from-code-drawer.tsx
import { Drawer } from "@langwatch/design-system/studio-drawer";
=======
import { RenderCode } from "~/components/code/RenderCode";
import { SetupWithAgentButton } from "~/components/SetupWithAgentButton";
import { useColorMode } from "~/components/ui/color-mode";
import { Drawer } from "~/components/ui/drawer";
import { useDrawer } from "~/hooks/useDrawer";
>>>>>>> origin/main:platform/app/src/components/agents/connected/ConnectFromCodeDrawer.tsx
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
<<<<<<< HEAD:modules/agent/web/src/ui/sections/connect-from-code-drawer.tsx
              label="Install command"
              renderCopyButton={renderCopyButton}
            />
            <CodeBlock
              code={snippets[language]}
              label="Snippet"
              renderCopyButton={renderCopyButton}
=======
              language="bash"
              colorMode={codeColorMode}
            />
            <CodeBlock
              code={snippets[language]}
              language={language}
              colorMode={codeColorMode}
>>>>>>> origin/main:platform/app/src/components/agents/connected/ConnectFromCodeDrawer.tsx
            />
          </VStack>
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

<<<<<<< HEAD:modules/agent/web/src/ui/sections/connect-from-code-drawer.tsx
function CodeBlock({
  code,
  label,
  renderCopyButton,
}: {
  code: string;
  label: string;
  renderCopyButton: ConnectFromCodeDrawerProps["renderCopyButton"];
}) {
  return (
    <HStack align="start" gap={2} background="bg.muted" borderRadius="md" paddingX={3} paddingY={2}>
      <Box as="pre" flex={1} overflowX="auto" fontFamily="mono" fontSize="12px" whiteSpace="pre">
        {code}
      </Box>
      {renderCopyButton({ value: code, label })}
    </HStack>
=======
/**
 * A highlighted block that follows the app color mode. Long lines keep their
 * width and scroll sideways, so the code the reader copies is the code shown.
 */
function CodeBlock({
  code,
  language,
  colorMode,
}: {
  code: string;
  language: string;
  colorMode: "light" | "dark";
}) {
  return (
    <Box
      borderRadius="md"
      borderWidth="1px"
      borderColor="border"
      overflow="hidden"
      width="full"
      // The GitHub themes Shiki paints with, so the padding around the
      // <pre> is the same color as the code itself.
      background={colorMode === "dark" ? "#24292e" : "#ffffff"}
      data-testid={`connect-code-${language}`}
    >
      <RenderCode
        code={code}
        language={language}
        colorMode={colorMode}
        wrap={false}
        style={{ width: "100%", fontSize: "12px", padding: "12px" }}
      />
    </Box>
>>>>>>> origin/main:platform/app/src/components/agents/connected/ConnectFromCodeDrawer.tsx
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
