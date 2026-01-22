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
import { api } from "~/utils/api";

export type WorkflowSelectorForEvaluatorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (evaluator: { id: string; name: string; workflowId: string }) => void;
  /** Name for the new evaluator (optional, prompts if not provided) */
  evaluatorName?: string;
};

/**
 * Drawer for selecting a workflow to use as an evaluator.
 * Features:
 * - Search filter for workflows
 * - Shows workflow name and last updated
 * - Creates evaluator with workflow reference on selection
 */
export function WorkflowSelectorForEvaluatorDrawer(
  props: WorkflowSelectorForEvaluatorDrawerProps,
) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const utils = api.useContext();

  const onClose = props.onClose ?? closeDrawer;
  const onSave =
    props.onSave ??
    (complexProps.onSave as WorkflowSelectorForEvaluatorDrawerProps["onSave"]);
  const isOpen = props.open !== false && props.open !== undefined;

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null,
  );
  const [evaluatorName, setEvaluatorName] = useState(props.evaluatorName ?? "");

  const workflowsQuery = api.workflow.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && isOpen },
  );

  // Get existing evaluators to check which workflows already have one
  const evaluatorsQuery = api.evaluators.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && isOpen },
  );

  // Set of workflow IDs that already have an evaluator
  const workflowsWithEvaluator = useMemo(() => {
    if (!evaluatorsQuery.data) return new Set<string>();
    return new Set(
      evaluatorsQuery.data
        .filter((e) => e.workflowId)
        .map((e) => e.workflowId as string)
    );
  }, [evaluatorsQuery.data]);

  const filteredWorkflows = useMemo(() => {
    if (!workflowsQuery.data) return [];

    const query = searchQuery.toLowerCase().trim();
    if (!query) return workflowsQuery.data;

    return workflowsQuery.data.filter((workflow) =>
      workflow.name.toLowerCase().includes(query),
    );
  }, [workflowsQuery.data, searchQuery]);

  const createMutation = api.evaluators.create.useMutation({
    onSuccess: (evaluator) => {
      void utils.evaluators.getAll.invalidate({ projectId: project?.id ?? "" });
      onSave?.({
        id: evaluator.id,
        name: evaluator.name,
        workflowId: evaluator.workflowId ?? "",
      });
      onClose();
    },
  });

  const isSaving = createMutation.isPending;

  const handleSelectWorkflow = useCallback(
    (workflowId: string, workflowName: string) => {
      // Don't allow selecting workflows that already have an evaluator
      if (workflowsWithEvaluator.has(workflowId)) return;

      setSelectedWorkflowId(workflowId);
      if (!evaluatorName) {
        setEvaluatorName(workflowName);
      }
    },
    [evaluatorName, workflowsWithEvaluator],
  );

  const handleSave = useCallback(() => {
    if (!project?.id || !selectedWorkflowId || !evaluatorName.trim()) return;

    // Double-check: prevent creating if workflow already has evaluator
    if (workflowsWithEvaluator.has(selectedWorkflowId)) return;

    createMutation.mutate({
      projectId: project.id,
      name: evaluatorName.trim(),
      type: "workflow",
      config: {},
      workflowId: selectedWorkflowId,
    });
  }, [project?.id, selectedWorkflowId, evaluatorName, createMutation, workflowsWithEvaluator]);

  const isValid = selectedWorkflowId &&
    evaluatorName.trim().length > 0 &&
    !workflowsWithEvaluator.has(selectedWorkflowId);

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
            <Text color="fg.muted" fontSize="sm" paddingX={6} paddingTop={4}>
              Select an existing workflow to use as a custom evaluator.
            </Text>

            {/* Evaluator name input */}
            <Box paddingX={6}>
              <Text fontWeight="medium" fontSize="sm" marginBottom={2}>
                Evaluator Name
              </Text>
              <Input
                value={evaluatorName}
                onChange={(e) => setEvaluatorName(e.target.value)}
                placeholder="Enter evaluator name"
                data-testid="evaluator-name-input"
              />
            </Box>

            {/* Search input */}
            <Box position="relative" paddingX={6}>
              <Box
                position="absolute"
                left={9}
                top="50%"
                transform="translateY(-50%)"
                color="fg.subtle"
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
                <Box paddingY={8} textAlign="center" color="fg.muted">
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
                    hasExistingEvaluator={workflowsWithEvaluator.has(workflow.id)}
                    onClick={() =>
                      handleSelectWorkflow(workflow.id, workflow.name)
                    }
                  />
                ))
              )}
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <HStack gap={3}>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="green"
              onClick={handleSave}
              disabled={!isValid || isSaving}
              loading={isSaving}
              data-testid="save-evaluator-button"
            >
              Create Evaluator
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
  hasExistingEvaluator?: boolean;
  onClick: () => void;
};

function WorkflowCard({
  name,
  updatedAt,
  isSelected,
  hasExistingEvaluator = false,
  onClick,
}: WorkflowCardProps) {
  const isDisabled = hasExistingEvaluator;

  return (
    <Box
      as="button"
      onClick={isDisabled ? undefined : onClick}
      padding={4}
      borderRadius="md"
      border="2px solid"
      borderColor={isSelected ? "green.500" : "border"}
      bg={isDisabled ? "bg.muted" : isSelected ? "green.subtle" : "bg.panel"}
      textAlign="left"
      width="full"
      opacity={isDisabled ? 0.6 : 1}
      cursor={isDisabled ? "not-allowed" : "pointer"}
      _hover={isDisabled ? {} : { borderColor: "green.400", bg: "green.50" }}
      transition="all 0.15s"
      data-testid={`workflow-card-${name}`}
    >
      <HStack gap={3}>
        <Box color={isDisabled ? "fg.muted" : isSelected ? "green.600" : "green.500"}>
          <Workflow size={20} />
        </Box>
        <VStack align="start" gap={0} flex={1}>
          <Text fontWeight="medium" fontSize="sm" color={isDisabled ? "fg.muted" : undefined}>
            {name}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {hasExistingEvaluator ? (
              "Already has an evaluator"
            ) : (
              <>
                Updated{" "}
                {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}
              </>
            )}
          </Text>
        </VStack>
      </HStack>
    </Box>
  );
}
