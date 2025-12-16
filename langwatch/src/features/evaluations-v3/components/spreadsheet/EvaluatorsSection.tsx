/**
 * Evaluators Section
 *
 * Spreadsheet section for evaluator columns showing scores and results.
 */

import {
  Badge,
  Box,
  Button,
  HStack,
  IconButton,
  Progress,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationV3Store } from "../../store/useEvaluationV3Store";
import { ColumnHeader, SuperHeader } from "./EvaluationSpreadsheet";
import { LuPlus, LuSettings, LuCircleAlert, LuCheck, LuX, LuMinus } from "react-icons/lu";
import { Tooltip } from "../../../../components/ui/tooltip";
import type { Evaluator, EvaluatorResult } from "../../types";

export function EvaluatorsSection({
  rowCount,
  onScroll,
}: {
  rowCount: number;
  onScroll?: (scrollTop: number) => void;
}) {
  const {
    evaluators,
    agents,
    currentRun,
    setActiveModal,
    getUnmappedEvaluatorInputs,
  } = useEvaluationV3Store(
    useShallow((s) => ({
      evaluators: s.evaluators,
      agents: s.agents,
      currentRun: s.currentRun,
      setActiveModal: s.setActiveModal,
      getUnmappedEvaluatorInputs: s.getUnmappedEvaluatorInputs,
    }))
  );

  // Calculate total width - each evaluator shows one column per agent
  const columnWidth = 140;
  const addButtonWidth = 160;
  const columnsPerEvaluator = Math.max(agents.length, 1);
  const totalWidth = evaluators.length > 0
    ? evaluators.length * columnsPerEvaluator * columnWidth + addButtonWidth
    : addButtonWidth + 100;

  const hasEvaluators = evaluators.length > 0;
  const hasAgents = agents.length > 0;

  return (
    <VStack
      gap={0}
      minWidth={`${totalWidth}px`}
      flexShrink={0}
    >
      {/* Super Header */}
      <SuperHeader title="Evaluators" colorScheme="green" minWidth={`${totalWidth}px`}>
        {hasEvaluators && (
          <Tooltip content="Add another evaluator">
            <Button
              variant="ghost"
              size="xs"
              colorPalette="green"
              onClick={() => setActiveModal({ type: "add-evaluator" })}
            >
              <LuPlus size={12} />
              Add Evaluator
            </Button>
          </Tooltip>
        )}
      </SuperHeader>

      {/* Column Headers */}
      <HStack gap={0} width="full">
        {!hasEvaluators ? (
          <Box
            height="36px"
            width={`${addButtonWidth + 100}px`}
            background="gray.50"
            borderBottom="2px solid"
            borderColor="gray.300"
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <Button
              variant="outline"
              size="sm"
              colorPalette="green"
              onClick={() => setActiveModal({ type: "add-evaluator" })}
              disabled={!hasAgents}
            >
              <LuPlus size={14} />
              Add Evaluator
              <Box
                as="span"
                width="18px"
                height="18px"
                borderRadius="full"
                background="orange.100"
                color="orange.600"
                display="flex"
                alignItems="center"
                justifyContent="center"
                fontSize="xs"
                fontWeight="bold"
                marginLeft={1}
              >
                !
              </Box>
            </Button>
          </Box>
        ) : (
          evaluators.map((evaluator) => (
            <EvaluatorColumnHeaders
              key={evaluator.id}
              evaluator={evaluator}
              agents={agents}
              columnWidth={columnWidth}
              hasUnmappedInputs={getUnmappedEvaluatorInputs(evaluator.id).length > 0}
              onEdit={() => setActiveModal({ type: "edit-evaluator", evaluatorId: evaluator.id })}
              onMapInputs={() => setActiveModal({ type: "evaluator-mapping", evaluatorId: evaluator.id })}
            />
          ))
        )}
        {hasEvaluators && (
          <Box
            height="36px"
            minWidth={`${addButtonWidth}px`}
            background="gray.50"
            borderBottom="2px solid"
            borderColor="gray.300"
          />
        )}
      </HStack>

      {/* Data Rows */}
      {Array.from({ length: rowCount }).map((_, rowIndex) => (
        <HStack key={rowIndex} gap={0} width="full">
          {!hasEvaluators ? (
            <Box
              height="40px"
              width={`${addButtonWidth + 100}px`}
              background={rowIndex % 2 === 0 ? "white" : "gray.50"}
              borderBottom="1px solid"
              borderColor="gray.100"
            />
          ) : (
            evaluators.map((evaluator) => (
              <EvaluatorResultCells
                key={evaluator.id}
                evaluator={evaluator}
                agents={agents}
                rowIndex={rowIndex}
                columnWidth={columnWidth}
                results={currentRun?.evaluatorResults.filter(
                  (r) => r.evaluatorId === evaluator.id && r.rowIndex === rowIndex
                ) ?? []}
                isRunning={currentRun?.status === "running"}
              />
            ))
          )}
          {hasEvaluators && (
            <Box
              height="40px"
              minWidth={`${addButtonWidth}px`}
              background={rowIndex % 2 === 0 ? "white" : "gray.50"}
              borderBottom="1px solid"
              borderColor="gray.100"
            />
          )}
        </HStack>
      ))}
    </VStack>
  );
}

/**
 * Evaluator Column Headers
 */
function EvaluatorColumnHeaders({
  evaluator,
  agents,
  columnWidth,
  hasUnmappedInputs,
  onEdit,
  onMapInputs,
}: {
  evaluator: Evaluator;
  agents: { id: string; name: string }[];
  columnWidth: number;
  hasUnmappedInputs: boolean;
  onEdit: () => void;
  onMapInputs: () => void;
}) {
  const columnsCount = Math.max(agents.length, 1);

  return (
    <Box borderRight="1px solid" borderColor="gray.200">
      {/* Evaluator name header */}
      <HStack
        height="36px"
        minWidth={`${columnsCount * columnWidth}px`}
        background="green.50"
        borderBottom="1px solid"
        borderColor="green.200"
        paddingX={2}
        gap={2}
      >
        <Text
          fontSize="xs"
          fontWeight="medium"
          color="green.700"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
          flex={1}
        >
          {evaluator.name}
        </Text>
        {hasUnmappedInputs && (
          <Tooltip content="Some required inputs are not mapped">
            <IconButton
              aria-label="Map inputs"
              variant="ghost"
              size="xs"
              colorPalette="orange"
              onClick={(e) => {
                e.stopPropagation();
                onMapInputs();
              }}
            >
              <LuCircleAlert size={14} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip content="Edit evaluator settings">
          <IconButton
            aria-label="Edit evaluator"
            variant="ghost"
            size="xs"
            colorPalette="green"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <LuSettings size={14} />
          </IconButton>
        </Tooltip>
      </HStack>
      {/* Agent-specific headers (when comparing multiple agents) */}
      <HStack gap={0}>
        {agents.length > 0 ? (
          agents.map((agent) => (
            <ColumnHeader
              key={agent.id}
              title={agent.name}
              width={`${columnWidth}px`}
            />
          ))
        ) : (
          <ColumnHeader
            title="Result"
            width={`${columnWidth}px`}
          />
        )}
      </HStack>
    </Box>
  );
}

/**
 * Evaluator Result Cells
 */
function EvaluatorResultCells({
  evaluator,
  agents,
  rowIndex,
  columnWidth,
  results,
  isRunning,
}: {
  evaluator: Evaluator;
  agents: { id: string; name: string }[];
  rowIndex: number;
  columnWidth: number;
  results: EvaluatorResult[];
  isRunning: boolean;
}) {
  const agentsToShow = agents.length > 0 ? agents : [{ id: "", name: "" }];

  return (
    <>
      {agentsToShow.map((agent) => {
        const result = results.find((r) => r.agentId === agent.id);
        const isPending = !result && isRunning;
        const hasError = result?.status === "error";
        const wasSkipped = result?.status === "skipped";

        return (
          <EvaluatorResultCell
            key={agent.id || "single"}
            result={result}
            isPending={isPending}
            hasError={hasError}
            wasSkipped={wasSkipped}
            rowIndex={rowIndex}
            columnWidth={columnWidth}
          />
        );
      })}
    </>
  );
}

/**
 * Single Evaluator Result Cell
 */
function EvaluatorResultCell({
  result,
  isPending,
  hasError,
  wasSkipped,
  rowIndex,
  columnWidth,
}: {
  result?: EvaluatorResult;
  isPending: boolean;
  hasError: boolean;
  wasSkipped: boolean;
  rowIndex: number;
  columnWidth: number;
}) {
  const getBgColor = () => {
    if (hasError) return "red.50";
    if (wasSkipped) return "gray.100";
    if (isPending) return "blue.50";
    if (result?.passed === true) return "green.50";
    if (result?.passed === false) return "red.50";
    return rowIndex % 2 === 0 ? "white" : "gray.50";
  };

  const renderContent = () => {
    if (isPending) {
      return <Spinner size="xs" color="blue.400" />;
    }

    if (hasError) {
      return (
        <Tooltip content={result?.details}>
          <HStack gap={1}>
            <LuX size={14} color="var(--chakra-colors-red-500)" />
            <Text fontSize="xs" color="red.600">
              Error
            </Text>
          </HStack>
        </Tooltip>
      );
    }

    if (wasSkipped) {
      return (
        <Tooltip content={result?.details}>
          <HStack gap={1}>
            <LuMinus size={14} color="var(--chakra-colors-gray-400)" />
            <Text fontSize="xs" color="gray.500">
              Skipped
            </Text>
          </HStack>
        </Tooltip>
      );
    }

    if (!result) return null;

    // Show passed/failed badge or score
    if (result.passed !== undefined) {
      return (
        <HStack gap={1}>
          {result.passed ? (
            <Badge colorPalette="green" size="sm">
              <LuCheck size={12} />
              Pass
            </Badge>
          ) : (
            <Badge colorPalette="red" size="sm">
              <LuX size={12} />
              Fail
            </Badge>
          )}
          {result.score !== undefined && (
            <Text fontSize="xs" color="gray.500">
              ({(result.score * 100).toFixed(0)}%)
            </Text>
          )}
        </HStack>
      );
    }

    if (result.score !== undefined) {
      const scorePercent = result.score * 100;
      return (
        <Tooltip content={result.details}>
          <HStack gap={2} width="full">
            <Progress.Root
              value={scorePercent}
              size="xs"
              colorPalette={scorePercent >= 70 ? "green" : scorePercent >= 40 ? "yellow" : "red"}
              flex={1}
            >
              <Progress.Track>
                <Progress.Range />
              </Progress.Track>
            </Progress.Root>
            <Text fontSize="xs" fontWeight="medium" color="gray.700" minWidth="35px">
              {scorePercent.toFixed(0)}%
            </Text>
          </HStack>
        </Tooltip>
      );
    }

    if (result.label) {
      return (
        <Badge colorPalette="blue" size="sm">
          {result.label}
        </Badge>
      );
    }

    return null;
  };

  return (
    <Box
      height="40px"
      width={`${columnWidth}px`}
      minWidth={`${columnWidth}px`}
      background={getBgColor()}
      borderBottom="1px solid"
      borderColor="gray.100"
      borderRight="1px solid"
      borderRightColor="gray.200"
      display="flex"
      alignItems="center"
      paddingX={2}
      gap={1}
    >
      {renderContent()}
    </Box>
  );
}

