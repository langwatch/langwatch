import { Box, Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import type { UiAgentTypeSelectorDrawerProps } from "@langwatch/browser-host/drawer";
import { Drawer } from "@langwatch/design-system/drawer";
import { ArrowLeft, Cable, Code, Globe, Workflow } from "lucide-react";

import { useAgentTypeSelection } from "../../behavior/use-agent-type-selection.ts";
import type { NewAgentType } from "../../model/new-agent-drawer.ts";

export type AgentType = NewAgentType;

export type AgentTypeSelectorDrawerProps = UiAgentTypeSelectorDrawerProps;

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
    <Drawer.Root
      open={open !== false && open !== undefined}
      onOpenChange={({ open: nextOpen }) => !nextOpen && selection.close()}
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
                onClick={onGoBack}
                padding={1}
                minWidth="auto"
                data-testid="back-button"
              >
                <ArrowLeft size={20} />
              </Button>
            )}
            <Heading>Choose Agent Connection Type</Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
          <VStack gap={4} align="stretch" flex={1} overflow="hidden">
            <Text color="fg.muted" fontSize="sm" paddingX={6} paddingTop={4}>
              Select how you want to integrate your agent for testing.
            </Text>

            <VStack gap={3} align="stretch" paddingX={6} paddingBottom={4}>
              <ConnectFromCodeCard onClick={selection.connectFromCode} />
              {agentTypes.map((agentType) => (
                <AgentTypeCard
                  key={agentType.type}
                  {...agentType}
                  onClick={() => selection.select(agentType.type)}
                />
              ))}
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <Button variant="outline" onClick={selection.close}>
            Cancel
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

/** Connect-from-code reuses the project's already-running agent. */
function ConnectFromCodeCard({ onClick }: { onClick: () => void }) {
  return (
    <Box
      as="button"
      onClick={onClick}
      padding={4}
      borderRadius="lg"
      border="1px solid"
      borderColor="border"
      bg="bg.panel"
      textAlign="left"
      width="full"
      _hover={{ borderColor: "green.muted", bg: "green.subtle" }}
      transition="all 0.15s"
      data-testid="agent-type-connected"
      cursor="pointer"
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
              background="green.500"
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
    </Box>
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
    <Box
      as="button"
      onClick={onClick}
      padding={4}
      borderRadius="lg"
      border="1px solid"
      borderColor="border"
      bg="bg.panel"
      textAlign="left"
      width="full"
      _hover={{ borderColor: "blue.muted", bg: "blue.subtle" }}
      transition="all 0.15s"
      data-testid={`agent-type-${type}`}
      cursor="pointer"
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
    </Box>
  );
}
