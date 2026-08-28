import { Box, Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";
import { ArrowLeft, Code, Globe, Workflow } from "lucide-react";

export type AgentType = "code" | "workflow" | "http";

export type AgentTypeSelectorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onGoBack?: () => void;
  canGoBack?: boolean;
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
  open = false,
  onClose,
  onGoBack,
  canGoBack = false,
  onSelect,
}: AgentTypeSelectorDrawerProps) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={({ open: nextOpen }) => !nextOpen && onClose?.()}
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
            <Heading>Choose Agent Type</Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
          <VStack gap={4} align="stretch" flex={1} overflow="hidden">
            <Text color="fg.muted" fontSize="sm" paddingX={6} paddingTop={4}>
              Select the type of agent you want to create.
            </Text>
            <VStack gap={3} align="stretch" paddingX={6} paddingBottom={4}>
              {agentTypes.map((agentType) => (
                <AgentTypeCard
                  key={agentType.type}
                  {...agentType}
                  onClick={() => onSelect?.(agentType.type)}
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
