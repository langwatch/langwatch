/**
 * The way to connect an agent from code (ADR-128), opened from the new
 * agent flow. The agent-first path comes first: hand the setup to a
 * coding agent or to Langy, or read the guide. The snippets below are
 * for the reader who pastes it in themselves.
 *
 * The drawer keeps listening while it is open, so the agent appears on
 * the page as soon as the process connects, with no reload.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { Box, Button, HStack, Tabs, Text, VStack } from "@chakra-ui/react";
import { LuArrowLeft } from "react-icons/lu";

import { CopyButton } from "~/components/CopyButton";
import { SetupWithAgentButton } from "~/components/SetupWithAgentButton";
import { Drawer } from "~/components/ui/drawer";
import { useDrawer } from "~/hooks/useDrawer";
import {
  connectSnippets,
  SNIPPET_LANGUAGE_LABELS,
  SNIPPET_LANGUAGES,
  type SnippetLanguage,
} from "./connect-snippets";

/** The install line of each language, above its snippet. */
const INSTALL_COMMANDS: Record<SnippetLanguage, string> = {
  python: "pip install langwatch",
  typescript: "npm install langwatch zod",
};

export type ConnectFromCodeDrawerProps = {
  open?: boolean;
  onClose?: () => void;
};

export function ConnectFromCodeDrawer(props: ConnectFromCodeDrawerProps) {
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const onClose = props.onClose ?? closeDrawer;
  const isOpen = props.open !== false && props.open !== undefined;
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
            {canGoBack && (
              <Button
                variant="ghost"
                size="sm"
                onClick={goBack}
                padding={1}
                minWidth="auto"
                data-testid="back-button"
              >
                <LuArrowLeft size={20} />
              </Button>
            )}
            <Drawer.Title>Connect from code</Drawer.Title>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <VStack
            align="stretch"
            gap={5}
            data-testid="connect-from-code-drawer"
          >
            <HStack justify="space-between" gap={3}>
              <Text fontSize="sm" color="fg.muted">
                Write a small function beside your service startup that calls
                the agent you already have.
              </Text>
              <SetupWithAgentButton surface="connectedAgents" />
            </HStack>

            <SnippetTabs snippets={snippets} />

            <ListeningIndicator />
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function SnippetTabs({
  snippets,
}: {
  snippets: Record<(typeof SNIPPET_LANGUAGES)[number], string>;
}) {
  return (
    // Without a colorPalette the line variant paints the selected trigger
    // with the default palette's fg, which reads fainter than the unselected
    // one. Same palette as the integrate drawer's language tabs.
    <Tabs.Root
      defaultValue="python"
      variant="line"
      size="sm"
      colorPalette="orange"
    >
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
            />
            <CodeBlock code={snippets[language]} label="Snippet" />
          </VStack>
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <HStack
      align="start"
      gap={2}
      background="bg.muted"
      borderRadius="md"
      paddingX={3}
      paddingY={2}
    >
      <Box
        as="pre"
        flex={1}
        overflowX="auto"
        fontFamily="mono"
        fontSize="12px"
        whiteSpace="pre"
      >
        {code}
      </Box>
      <CopyButton value={code} label={label} />
    </HStack>
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
