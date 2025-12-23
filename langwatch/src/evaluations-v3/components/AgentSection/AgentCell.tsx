import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Check, ChevronDown, ChevronUp, Code, Plus, X } from "react-feather";

import { ColorfulBlockIcon } from "~/optimization_studio/components/ColorfulBlockIcons";
import { LLMIcon } from "~/components/icons/LLMIcon";
import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";
import type { AgentConfig, EvaluatorConfig } from "../../types";

// ============================================================================
// Evaluator Chip Component
// ============================================================================

type EvaluatorChipProps = {
  evaluator: EvaluatorConfig;
  result: unknown;
  agentId: string;
  row: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
};

export function EvaluatorChip({
  evaluator,
  result,
  isExpanded,
  onToggleExpand,
  onEdit,
}: EvaluatorChipProps) {
  // Determine pass/fail status from result
  let status: "pending" | "passed" | "failed" | "error" = "pending";
  let score: number | undefined;

  if (result !== null && result !== undefined) {
    if (typeof result === "boolean") {
      status = result ? "passed" : "failed";
    } else if (typeof result === "object") {
      const obj = result as Record<string, unknown>;
      if ("passed" in obj) {
        status = obj.passed ? "passed" : "failed";
      }
      if ("score" in obj && typeof obj.score === "number") {
        score = obj.score;
      }
      if ("error" in obj) {
        status = "error";
      }
    }
  }

  const statusColors = {
    pending: { bg: "gray.100", color: "gray.600", icon: null },
    passed: { bg: "green.100", color: "green.700", icon: <Check size={10} /> },
    failed: { bg: "red.100", color: "red.700", icon: <X size={10} /> },
    error: { bg: "orange.100", color: "orange.700", icon: <X size={10} /> },
  };

  const statusConfig = statusColors[status];

  return (
    <Box>
      <HStack
        as="button"
        onClick={onToggleExpand}
        bg={statusConfig.bg}
        color={statusConfig.color}
        paddingX={2}
        paddingY={1}
        borderRadius="md"
        fontSize="11px"
        fontWeight="medium"
        gap={1}
        _hover={{ opacity: 0.8 }}
        cursor="pointer"
      >
        {statusConfig.icon}
        <Text>{evaluator.name}</Text>
        {score !== undefined && <Text>({score.toFixed(2)})</Text>}
        {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </HStack>

      {isExpanded && (
        <Box
          marginTop={2}
          padding={2}
          bg="gray.50"
          borderRadius="md"
          fontSize="12px"
        >
          <VStack align="stretch" gap={1}>
            <Text fontWeight="medium">Result:</Text>
            <Text color="gray.600" whiteSpace="pre-wrap">
              {result === null || result === undefined
                ? "No result yet"
                : typeof result === "object"
                  ? JSON.stringify(result, null, 2)
                  : String(result)}
            </Text>
            <Button
              size="xs"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              marginTop={1}
            >
              Edit Configuration
            </Button>
          </VStack>
        </Box>
      )}
    </Box>
  );
}

// ============================================================================
// Agent Cell Content Component
// ============================================================================

type AgentCellContentProps = {
  agent: AgentConfig;
  output: unknown;
  evaluatorResults: Record<string, unknown>;
  row: number;
  evaluatorsMap: Map<string, EvaluatorConfig>;
};

export function AgentCellContent({
  agent,
  output,
  evaluatorResults,
  row,
  evaluatorsMap,
}: AgentCellContentProps) {
  const { ui, openOverlay, setExpandedEvaluator } = useEvaluationsV3Store(
    (state) => ({
      ui: state.ui,
      openOverlay: state.openOverlay,
      setExpandedEvaluator: state.setExpandedEvaluator,
    })
  );

  const displayOutput =
    output === null || output === undefined
      ? ""
      : typeof output === "object"
        ? JSON.stringify(output)
        : String(output);

  // Get evaluator configs for this agent's evaluatorIds
  const agentEvaluators = agent.evaluatorIds
    .map((id) => evaluatorsMap.get(id))
    .filter((e): e is EvaluatorConfig => e !== undefined);

  return (
    <VStack align="stretch" gap={2}>
      {/* Agent output */}
      <Text fontSize="13px" lineClamp={3}>
        {displayOutput || <Text as="span" color="gray.400">No output yet</Text>}
      </Text>

      {/* Evaluator chips */}
      {agentEvaluators.length > 0 && (
        <HStack flexWrap="wrap" gap={1}>
          {agentEvaluators.map((evaluator) => {
            const isExpanded =
              ui.expandedEvaluator?.agentId === agent.id &&
              ui.expandedEvaluator?.evaluatorId === evaluator.id &&
              ui.expandedEvaluator?.row === row;

            return (
              <EvaluatorChip
                key={evaluator.id}
                evaluator={evaluator}
                result={evaluatorResults[evaluator.id]}
                agentId={agent.id}
                row={row}
                isExpanded={isExpanded}
                onToggleExpand={() => {
                  if (isExpanded) {
                    setExpandedEvaluator(undefined);
                  } else {
                    setExpandedEvaluator({
                      agentId: agent.id,
                      evaluatorId: evaluator.id,
                      row,
                    });
                  }
                }}
                onEdit={() => openOverlay("evaluator", agent.id, evaluator.id)}
              />
            );
          })}
        </HStack>
      )}

      {/* Add evaluator button */}
      <Button
        size="xs"
        variant="ghost"
        color="gray.500"
        onClick={(e) => {
          e.stopPropagation();
          openOverlay("evaluator", agent.id);
        }}
        justifyContent="flex-start"
        paddingX={1}
      >
        <Plus size={10} />
        <Text marginLeft={1}>Add evaluator</Text>
      </Button>
    </VStack>
  );
}

// ============================================================================
// Agent Header Component
// ============================================================================

export function AgentHeader({ agent }: { agent: AgentConfig }) {
  const { openOverlay } = useEvaluationsV3Store((state) => ({
    openOverlay: state.openOverlay,
  }));

  return (
    <HStack
      gap={2}
      cursor="pointer"
      onClick={() => openOverlay("agent", agent.id)}
      _hover={{ color: "green.600" }}
    >
      <ColorfulBlockIcon
        color={agent.type === "llm" ? "green.400" : "#3E5A60"}
        size="xs"
        icon={agent.type === "llm" ? <LLMIcon /> : <Code size={12} />}
      />
      <Text fontSize="13px" fontWeight="medium">
        {agent.name}
      </Text>
    </HStack>
  );
}
