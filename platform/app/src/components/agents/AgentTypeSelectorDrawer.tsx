import { Box, Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { Cable, Code, Globe, Workflow } from "lucide-react";
import { LuArrowLeft } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import { getComplexProps, useDrawer } from "~/hooks/useDrawer";

/**
 * Agent types - code, workflow, or http.
 * Note: "signature" (prompt) agents have been removed.
 * Use the Prompts feature directly for LLM-based prompts.
 */
export type AgentType = "code" | "workflow" | "http";

export type AgentTypeSelectorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (type: AgentType) => void;
};

const agentTypes: Array<{
  type: AgentType;
  icon: typeof Code;
  title: string;
  description: string;
}> = [
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
    description:
      "Write custom Python code to process inputs and generate outputs",
  },
  {
    type: "workflow",
    icon: Workflow,
    title: "Workflow Agent",
    description: "Create a new workflow for custom agent logic",
  },
];

/**
 * Drawer for selecting the type of agent to create.
 * Shows cards for Code and Workflow agent types.
 * Note: Prompt-based agents have been removed - use Prompts directly instead.
 */
export function AgentTypeSelectorDrawer(props: AgentTypeSelectorDrawerProps) {
  const { closeDrawer, openDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();

  const onClose = props.onClose ?? closeDrawer;
  const onSelect =
    props.onSelect ??
    (complexProps.onSelect as AgentTypeSelectorDrawerProps["onSelect"]);
  const isOpen = props.open !== false && props.open !== undefined;

  const handleSelectType = (type: AgentType) => {
    onSelect?.(type);
    // Navigate to the appropriate editor drawer based on type
    switch (type) {
      case "code":
        openDrawer("agentCodeEditor");
        break;
      case "workflow":
        openDrawer("workflowSelector");
        break;
      case "http":
        openDrawer("agentHttpEditor");
        break;
      default: {
        const _exhaustive: never = type;
        throw new Error(`Unhandled agent type: ${_exhaustive}`);
      }
    }
  };

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
            <Heading>Choose Agent Connection Type</Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body
          display="flex"
          flexDirection="column"
          overflow="hidden"
          padding={0}
        >
          <VStack gap={4} align="stretch" flex={1} overflow="hidden">
            <Text color="fg.muted" fontSize="sm" paddingX={6} paddingTop={4}>
              Select how you want to integrate your agent for testing.
            </Text>

            <VStack gap={3} align="stretch" paddingX={6} paddingBottom={4}>
              <ConnectFromCodeCard
                onClick={() => openDrawer("agentConnectFromCode")}
              />
              {agentTypes.map((agentType) => (
                <AgentTypeCard
                  key={agentType.type}
                  {...agentType}
                  onClick={() => handleSelectType(agentType.type)}
                />
              ))}
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

/**
 * The first choice of the flow: connect the agent the project already
 * runs instead of writing one here. The green dot is the same one an
 * online agent wears, since that is what the choice ends as. The copy
 * follows the connect-your-agent docs page: a small connect function
 * beside the service startup calls the agent that already exists.
 */
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

function AgentTypeCard({
  type,
  icon: Icon,
  title,
  description,
  onClick,
}: AgentTypeCardProps) {
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
