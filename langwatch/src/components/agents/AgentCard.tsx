import { Box,Card, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { Bot, Code, Globe, MessageSquare, MoreVertical, Workflow } from "lucide-react";
import { LuPencil, LuTrash2 } from "react-icons/lu";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { Menu } from "../ui/menu";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

const agentTypeIcons: Record<string, typeof MessageSquare> = {
  signature: MessageSquare,
  code: Code,
  http: Globe,
  workflow: Workflow,
};

const agentTypeLabels: Record<string, string> = {
  signature: "Prompt",
  code: "Code",
  http: "HTTP",
  workflow: "Workflow",
};

export type AgentCardProps = {
  agent: TypedAgent;
  onClick?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
};

export function AgentCard({
  agent,
  onClick,
  onEdit,
  onDelete,
}: AgentCardProps) {
  const Icon = agentTypeIcons[agent.type] ?? Bot;
  const typeLabel = agentTypeLabels[agent.type] ?? agent.type;

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't trigger if clicking within menu
    const target = e.target as HTMLElement;
    if (target.closest(".js-inner-menu")) return;
    onClick?.();
  };

  return (
    <Card.Root
      variant="elevated"
      onClick={handleCardClick}
      cursor="pointer"
      height="142px"
      transition="all 0.2s ease-in-out"
      data-testid={`agent-card-${agent.id}`}
    >
      <Card.Body padding={4}>
        <VStack align="start" gap={2} height="full">
          {/* Top row: Icon and menu */}
          <HStack width="full">
            <Box bg="blue.50" padding={1} borderRadius="md">
              <Icon size={18} color="var(--chakra-colors-blue-600)" />
            </Box>
            <Spacer />
            {(onEdit || onDelete) && (
              <Menu.Root>
                <Menu.Trigger
                  className="js-inner-menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical size={16} />
                </Menu.Trigger>
                <Menu.Content className="js-inner-menu" portalled={false}>
                  {onEdit && (
                    <Menu.Item
                      value="edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit();
                      }}
                    >
                      <LuPencil size={14} />
                      Edit
                    </Menu.Item>
                  )}
                  {onDelete && (
                    <Menu.Item
                      value="delete"
                      color="red.500"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                      }}
                    >
                      <LuTrash2 size={14} />
                      Delete
                    </Menu.Item>
                  )}
                </Menu.Content>
              </Menu.Root>
            )}
          </HStack>

          <Spacer />

          {/* Name */}
          <Text color="gray.600" fontSize="sm" fontWeight={500}>
            {agent.name}
          </Text>

          {/* Metadata */}
          <Text color="gray.400" fontSize="12px">
            {typeLabel} • {formatTimeAgo(new Date(agent.updatedAt).getTime())}
          </Text>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
