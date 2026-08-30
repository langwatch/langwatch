/**
 * What a project reads while no agent is connected from code (ADR-128).
 *
 * The panel is the whole setup: install the SDK, decorate the function,
 * start the process. It keeps listening while it is open, so the agent
 * appears on the page as soon as the process connects, with no reload.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { Box, Button, HStack, Tabs, Text, VStack } from "@chakra-ui/react";
import { CopyButton } from "~/components/CopyButton";
import {
  connectSnippets,
  SNIPPET_LANGUAGE_LABELS,
  SNIPPET_LANGUAGES,
  type SnippetLanguage,
} from "./connect-snippets";

/** The install line of each language, above its snippet. */
const INSTALL_COMMANDS: Record<SnippetLanguage, string> = {
  python: "pip install langwatch",
  typescript: "npm install langwatch",
};

export function ConnectAgentPanel({
  name,
  environment,
  onCreateOtherAgent,
}: {
  /** The agent the snippets name; the example agent when none is given. */
  name?: string;
  environment?: string | null;
  /** The way to the other agent kinds, when this panel stands for the page. */
  onCreateOtherAgent?: () => void;
}) {
  const snippets = connectSnippets({ name, environment });

  return (
    <VStack
      align="stretch"
      gap={4}
      width="full"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      padding={5}
      data-testid="connect-agent-panel"
    >
      <VStack align="start" gap={1}>
        <Text fontWeight="medium">Connect an agent from code</Text>
        <Text fontSize="sm" color="fg.muted">
          Decorate the function that runs your agent and start the process. It
          appears here and simulations run against your own code.
        </Text>
      </VStack>

      <Tabs.Root defaultValue="python" variant="line" size="sm">
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

      <HStack gap={3}>
        <ListeningIndicator />
        {onCreateOtherAgent ? (
          <Button
            variant="outline"
            size="xs"
            marginLeft="auto"
            onClick={onCreateOtherAgent}
            data-testid="connect-agent-other-kinds"
          >
            Set up another kind of agent
          </Button>
        ) : null}
      </HStack>
    </VStack>
  );
}

/** One block of code with the button that copies it. */
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

/** The line that says the page is waiting for the process to connect. */
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
