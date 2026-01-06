import {
  Box,
  Button,
  Heading,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { formatDistanceToNow } from "date-fns";
import { Search, Workflow } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { LuArrowLeft } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import { getComplexProps, useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { api } from "~/utils/api";

export type WorkflowSelectorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (agent: TypedAgent) => void;
  /** Name for the new agent (optional, prompts if not provided) */
  agentName?: string;
};

/**
 * Drawer for selecting a workflow to use as an agent.
 * Features:
 * - Search filter for workflows
 * - Shows workflow name and last updated
 * - Creates agent with workflow reference on selection
 */
export function WorkflowSelectorDrawer(props: WorkflowSelectorDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const utils = api.useContext();

  const onClose = props.onClose ?? closeDrawer;
  const onSave =
    props.onSave ??
    (complexProps.onSave as WorkflowSelectorDrawerProps["onSave"]);
  const isOpen = props.open !== false && props.open !== undefined;

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null,
  );
  const [agentName, setAgentName] = useState(props.agentName ?? "");

  const workflowsQuery = api.workflow.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && isOpen },
  );

  const filteredWorkflows = useMemo(() => {
    if (!workflowsQuery.data) return [];

    const query = searchQuery.toLowerCase().trim();
    if (!query) return workflowsQuery.data;

    return workflowsQuery.data.filter((workflow) =>
      workflow.name.toLowerCase().includes(query),
    );
  }, [workflowsQuery.data, searchQuery]);

  const createMutation = api.agents.create.useMutation({
    onSuccess: (agent) => {
      void utils.agents.getAll.invalidate({ projectId: project?.id ?? "" });
      onSave?.(agent);
      onClose();
    },
  });

  const isSaving = createMutation.isPending;

  const handleSelectWorkflow = useCallback(
    (workflowId: string, workflowName: string) => {
      setSelectedWorkflowId(workflowId);
      if (!agentName) {
        setAgentName(workflowName);
      }
    },
    [agentName],
  );

  const handleSave = useCallback(() => {
    if (!project?.id || !selectedWorkflowId || !agentName.trim()) return;

    // Build DSL-compatible Custom component config
    const config = {
      name: agentName.trim(),
      isCustom: true,
      workflow_id: selectedWorkflowId,
    };

    createMutation.mutate({
      projectId: project.id,
      name: agentName.trim(),
      type: "workflow",
      config,
      workflowId: selectedWorkflowId,
    });
  }, [project?.id, selectedWorkflowId, agentName, createMutation]);

  const isValid = selectedWorkflowId && agentName.trim().length > 0;

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="md"
    >
      <Drawer.Content>
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
            <Heading>Select Workflow</Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body
          display="flex"
          flexDirection="column"
          overflow="hidden"
          padding={0}
        >
          <VStack gap={4} align="stretch" flex={1} overflow="hidden">
            <Text color="gray.600" fontSize="sm" paddingX={6} paddingTop={4}>
              Select an existing workflow to use as the agent implementation.
            </Text>

            {/* Agent name input */}
            <Box paddingX={6}>
              <Text fontWeight="medium" fontSize="sm" marginBottom={2}>
                Agent Name
              </Text>
              <Input
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="Enter agent name"
                data-testid="agent-name-input"
              />
            </Box>

            {/* Search input */}
            <Box position="relative" paddingX={6}>
              <Box
                position="absolute"
                left={9}
                top="50%"
                transform="translateY(-50%)"
                color="gray.400"
                zIndex={1}
              >
                <Search size={16} />
              </Box>
              <Input
                placeholder="Search workflows..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                paddingLeft={10}
                data-testid="search-workflows-input"
              />
            </Box>

            {/* Workflow list - scrollable */}
            <VStack
              gap={2}
              align="stretch"
              flex={1}
              overflowY="auto"
              paddingX={6}
              paddingBottom={4}
            >
              {workflowsQuery.isLoading ? (
                <HStack justify="center" paddingY={8}>
                  <Spinner size="md" />
                </HStack>
              ) : filteredWorkflows.length === 0 ? (
                <Box paddingY={8} textAlign="center" color="gray.500">
                  {searchQuery
                    ? "No workflows match your search"
                    : "No workflows found in this project"}
                </Box>
              ) : (
                filteredWorkflows.map((workflow) => (
                  <WorkflowCard
                    key={workflow.id}
                    name={workflow.name}
                    updatedAt={workflow.updatedAt}
                    isSelected={selectedWorkflowId === workflow.id}
                    onClick={() =>
                      handleSelectWorkflow(workflow.id, workflow.name)
                    }
                  />
                ))
              )}
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="gray.200">
          <HStack gap={3}>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              onClick={handleSave}
              disabled={!isValid || isSaving}
              loading={isSaving}
              data-testid="save-agent-button"
            >
              Create Agent
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

// ============================================================================
// Workflow Card Component
// ============================================================================

type WorkflowCardProps = {
  name: string;
  updatedAt: Date;
  isSelected: boolean;
  onClick: () => void;
};

function WorkflowCard({
  name,
  updatedAt,
  isSelected,
  onClick,
}: WorkflowCardProps) {
  return (
    <Box
      as="button"
      onClick={onClick}
      padding={4}
      borderRadius="md"
      border="2px solid"
      borderColor={isSelected ? "blue.500" : "gray.200"}
      bg={isSelected ? "blue.50" : "white"}
      textAlign="left"
      width="full"
      _hover={{ borderColor: "blue.400", bg: "blue.50" }}
      transition="all 0.15s"
      data-testid={`workflow-card-${name}`}
    >
      <HStack gap={3}>
        <Box color={isSelected ? "blue.600" : "blue.500"}>
          <Workflow size={20} />
        </Box>
        <VStack align="start" gap={0} flex={1}>
          <Text fontWeight="medium" fontSize="sm">
            {name}
          </Text>
          <Text fontSize="xs" color="gray.500">
            Updated{" "}
            {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}
          </Text>
        </VStack>
      </HStack>
    </Box>
  );
}
