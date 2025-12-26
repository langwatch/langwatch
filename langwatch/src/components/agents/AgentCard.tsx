import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Bot, Code, MessageSquare, Workflow } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { TypedAgent } from "~/server/agents/agent.repository";

const agentTypeIcons: Record<string, typeof MessageSquare> = {
  signature: MessageSquare,
  code: Code,
  workflow: Workflow,
};

const agentTypeLabels: Record<string, string> = {
  signature: "Prompt",
  code: "Code",
  workflow: "Workflow",
};

export type AgentCardProps = {
  agent: TypedAgent;
  onClick?: () => void;
};

export function AgentCard({ agent, onClick }: AgentCardProps) {
  const Icon = agentTypeIcons[agent.type] ?? Bot;
  const typeLabel = agentTypeLabels[agent.type] ?? agent.type;

  return (
    <Box
      as="button"
      onClick={onClick}
      padding={4}
      borderRadius="lg"
      border="1px solid"
      borderColor="gray.200"
      bg="white"
      textAlign="left"
      width="full"
      _hover={{ borderColor: "blue.400", bg: "blue.50" }}
      transition="all 0.15s"
      data-testid={`agent-card-${agent.id}`}
    >
      <HStack gap={3} align="start">
        <Box
          padding={2}
          borderRadius="md"
          bg="blue.50"
          color="blue.600"
        >
          <Icon size={20} />
        </Box>
        <VStack align="start" gap={1} flex={1}>
          <Text fontWeight="semibold" fontSize="sm">
            {agent.name}
          </Text>
          <HStack gap={2} fontSize="xs" color="gray.500">
            <Text>{typeLabel}</Text>
            <Text>•</Text>
            <Text>
              Updated {formatDistanceToNow(new Date(agent.updatedAt), { addSuffix: true })}
            </Text>
          </HStack>
        </VStack>
      </HStack>
    </Box>
  );
}

