import {
  Box,
  Button,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Code, Globe, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useRecentTargets } from "../../hooks/useRecentTargets";
import { api } from "../../utils/api";
import { Dialog } from "../ui/dialog";

interface AgentPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (agentId: string) => void;
  onCreateNew: () => void;
}

/**
 * Modal for selecting an agent to run a scenario against.
 * Shows recent agents, search, and all agents list.
 */
export function AgentPickerModal({
  open,
  onClose,
  onSelect,
  onCreateNew,
}: AgentPickerModalProps) {
  const { project } = useOrganizationTeamProject();
  const { data: agents, isLoading } = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const { recentAgentIds } = useRecentTargets();
  const [searchValue, setSearchValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search input when modal opens
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setSearchValue("");
    }
  }, [open]);

  // Filter to HTTP agents only (for now)
  const httpAgents = useMemo(() => {
    return agents?.filter((a) => a.type === "http") ?? [];
  }, [agents]);

  // Get recent agents that still exist
  const recentAgents = useMemo(() => {
    return recentAgentIds
      .map((id) => httpAgents.find((a) => a.id === id))
      .filter(Boolean) as typeof httpAgents;
  }, [recentAgentIds, httpAgents]);

  // Filter by search
  const filteredAgents = useMemo(() => {
    if (!searchValue) return httpAgents;
    return httpAgents.filter((a) =>
      a.name.toLowerCase().includes(searchValue.toLowerCase()),
    );
  }, [httpAgents, searchValue]);

  // Filter recent by search too
  const filteredRecent = useMemo(() => {
    if (!searchValue) return recentAgents;
    return recentAgents.filter((a) =>
      a.name.toLowerCase().includes(searchValue.toLowerCase()),
    );
  }, [recentAgents, searchValue]);

  const handleSelect = (agentId: string) => {
    onSelect(agentId);
    onClose();
  };

  const handleCreateNew = () => {
    onCreateNew();
    onClose();
  };

  const hasAgents = httpAgents.length > 0;
  const hasResults = filteredAgents.length > 0;

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content maxWidth="500px">
        <Dialog.Header>
          <Dialog.Title>Run with Agent</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body paddingX={0} paddingBottom={0}>
          {isLoading ? (
            <VStack padding={8}>
              <Spinner />
            </VStack>
          ) : !hasAgents ? (
            // Empty state
            <VStack padding={8} gap={4}>
              <Box padding={4} borderRadius="full" backgroundColor="gray.100">
                <Globe size={32} color="var(--chakra-colors-gray-400)" />
              </Box>
              <Text fontWeight="medium" fontSize="lg">
                No agents yet
              </Text>
              <Text color="gray.500" textAlign="center">
                Create an agent to test your scenario against an external HTTP
                endpoint.
              </Text>
              <Button
                colorPalette="blue"
                onClick={handleCreateNew}
                marginTop={2}
              >
                <Plus size={14} />
                Create new agent
              </Button>
            </VStack>
          ) : (
            <VStack gap={0} align="stretch">
              {/* Search Input */}
              <Box paddingX={4} paddingBottom={3}>
                <Input
                  ref={inputRef}
                  size="sm"
                  placeholder="Search agents..."
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                />
              </Box>

              {/* Scrollable Content */}
              <Box maxHeight="400px" overflowY="auto">
                {/* Recent Section */}
                {filteredRecent.length > 0 && (
                  <Box>
                    <Text
                      fontSize="xs"
                      fontWeight="bold"
                      textTransform="uppercase"
                      color="gray.500"
                      paddingX={4}
                      paddingY={2}
                      bg="gray.50"
                    >
                      Recent
                    </Text>
                    {filteredRecent.map((agent) => (
                      <AgentRow
                        key={agent.id}
                        name={agent.name}
                        type={agent.type}
                        onClick={() => handleSelect(agent.id)}
                      />
                    ))}
                  </Box>
                )}

                {/* All Agents Section */}
                <Box>
                  <Text
                    fontSize="xs"
                    fontWeight="bold"
                    textTransform="uppercase"
                    color="gray.500"
                    paddingX={4}
                    paddingY={2}
                    bg="gray.50"
                  >
                    {searchValue ? "Search Results" : "All Agents"}
                  </Text>
                  {!hasResults ? (
                    <Text
                      fontSize="sm"
                      color="gray.400"
                      paddingX={4}
                      paddingY={3}
                    >
                      No agents found
                    </Text>
                  ) : (
                    filteredAgents.map((agent) => (
                      <AgentRow
                        key={agent.id}
                        name={agent.name}
                        type={agent.type}
                        onClick={() => handleSelect(agent.id)}
                      />
                    ))
                  )}
                </Box>
              </Box>

              {/* Create New */}
              <Box
                borderTopWidth="1px"
                borderColor="gray.200"
                paddingX={4}
                paddingY={3}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  colorPalette="blue"
                  onClick={handleCreateNew}
                  width="full"
                  justifyContent="flex-start"
                >
                  <Plus size={14} />
                  Create new agent
                </Button>
              </Box>
            </VStack>
          )}
        </Dialog.Body>
        <Dialog.Footer borderTopWidth="1px">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

interface AgentRowProps {
  name: string;
  type: string;
  onClick: () => void;
}

function AgentRow({ name, type, onClick }: AgentRowProps) {
  const Icon = type === "http" ? Globe : Code;
  const typeLabel = type === "http" ? "HTTP" : "Code";

  return (
    <HStack
      paddingX={4}
      paddingY={3}
      cursor="pointer"
      _hover={{ bg: "gray.50" }}
      onClick={onClick}
      gap={3}
    >
      <Icon size={16} color="var(--chakra-colors-gray-500)" />
      <Text fontSize="sm" flex={1}>
        {name}
      </Text>
      <Text fontSize="xs" color="gray.400">
        {typeLabel}
      </Text>
    </HStack>
  );
}
