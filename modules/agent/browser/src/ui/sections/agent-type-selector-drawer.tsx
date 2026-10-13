import { Card } from "@langwatch/design-system/card";
import { Drawer } from "@langwatch/design-system/drawer";
import { Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Cable, Code, Globe, Mic, Workflow } from "lucide-react";

import { useAgentTypeSelection } from "../../behavior/use-agent-type-selection.ts";
import type { NewAgentType } from "../../model/new-agent-drawer.ts";

export type AgentType = NewAgentType;

/** What a caller hands agent's type selector drawer. */
export type AgentTypeSelectorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onGoBack?: () => void;
  canGoBack?: boolean;
  onSelect?: (type: NewAgentType) => void;
  /** Where "Connect from Code" goes; opened by address, it navigates to the connect drawer. */
  onConnectFromCode?: () => void;
};

const agentTypes: {
  type: AgentType;
  icon: typeof Code;
  title: string;
  description: string;
}[] = [
  {
    type: "http",
    icon: Globe,
    title: "HTTP Agent",
    description: "Connect to an external API endpoint to process requests",
  },
  {
    type: "voice",
    icon: Mic,
    title: "Voice Agent",
    description: "Test a voice agent hosted on ElevenLabs: talk to it or send a simulated caller",
  },
  {
    type: "code",
    icon: Code,
    title: "Code Agent",
    description: "Write custom Python code to process inputs and generate outputs",
  },
  {
    type: "workflow",
    icon: Workflow,
    title: "Workflow Agent",
    description: "Create a new workflow for custom agent logic",
  },
];

export function AgentTypeSelectorDrawer({
  open,
  onClose,
  onGoBack,
  canGoBack = false,
  onSelect,
  onConnectFromCode,
}: AgentTypeSelectorDrawerProps) {
  const selection = useAgentTypeSelection({ onSelect, onClose, onConnectFromCode });
  return (
    <Drawer
      open={open !== false && open !== undefined}
      onClose={selection.close}
      onBack={canGoBack ? onGoBack : void 0}
      backButtonTestId="back-button"
      size="md"
      title="Choose Agent Connection Type"
      footer={{ cancel: { onClick: selection.close } }}
    >
      <VStack gap={4} align="stretch">
        <Text color="fg.muted" fontSize="sm">
          Select how you want to integrate your agent for testing.
        </Text>

        <VStack gap={3} align="stretch">
          <ConnectFromCodeCard onClick={selection.connectFromCode} />
          {agentTypes
            .filter((agentType) => agentType.type !== "voice" || selection.voiceEnabled)
            .map((agentType) => (
              <AgentTypeCard
                key={agentType.type}
                {...agentType}
                onClick={() => selection.select(agentType.type)}
              />
            ))}
        </VStack>
      </VStack>
    </Drawer>
  );
}

/** Connect-from-code reuses the project's already-running agent. */
function ConnectFromCodeCard({ onClick }: { onClick: () => void }) {
  return (
    <Card
      opener={
        <button
          type="button"
          aria-label="Connect from Code"
          onClick={onClick}
          data-testid="agent-type-connected"
        />
      }
    >
      <HStack gap={3} align="start">
        <Box padding={1} borderRadius="md" bg="green.subtle" color="green.fg">
          <Cable size={18} />
        </Box>
        <VStack align="start" gap={1} flex={1}>
          <HStack gap={2}>
            <Box
              boxSize="8px"
              borderRadius="full"
              background="green.solid"
              data-testid="agent-type-connected-dot"
            />
            <Text fontWeight="500" fontSize="sm">
              Connect from Code
            </Text>
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            Setup your agent to connect automatically when it starts up
          </Text>
        </VStack>
      </HStack>
    </Card>
  );
}

// ============================================================================
// Agent Type Card Component
// ============================================================================

type AgentTypeCardProps = {
  type: AgentType;
  icon: typeof Code;
  title: string;
  description: string;
  onClick: () => void;
};

function AgentTypeCard({ type, icon: Icon, title, description, onClick }: AgentTypeCardProps) {
  return (
    <Card
      opener={
        <button
          type="button"
          aria-label={title}
          onClick={onClick}
          data-testid={`agent-type-${type}`}
        />
      }
    >
      <HStack gap={3} align="start">
        <Box padding={1} borderRadius="md" bg="blue.subtle" color="blue.fg">
          <Icon size={18} />
        </Box>
        <VStack align="start" gap={1} flex={1}>
          <Text fontWeight="500" fontSize="sm">
            {title}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {description}
          </Text>
        </VStack>
      </HStack>
    </Card>
  );
}
