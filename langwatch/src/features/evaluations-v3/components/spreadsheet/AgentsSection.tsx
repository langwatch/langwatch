/**
 * Agents Section
 *
 * Spreadsheet section for agent (executor) columns showing outputs and results.
 */

import {
  Box,
  Button,
  HStack,
  IconButton,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationV3Store } from "../../store/useEvaluationV3Store";
import { ColumnHeader, SpreadsheetCell, SuperHeader } from "./EvaluationSpreadsheet";
import { LuPlus, LuSettings, LuCode, LuBrain, LuCircleAlert } from "react-icons/lu";
import { Tooltip } from "../../../../components/ui/tooltip";
import type { Agent } from "../../types";

export function AgentsSection({
  rowCount,
  onScroll,
}: {
  rowCount: number;
  onScroll?: (scrollTop: number) => void;
}) {
  const {
    agents,
    currentRun,
    setActiveModal,
    getUnmappedAgentInputs,
  } = useEvaluationV3Store(
    useShallow((s) => ({
      agents: s.agents,
      currentRun: s.currentRun,
      setActiveModal: s.setActiveModal,
      getUnmappedAgentInputs: s.getUnmappedAgentInputs,
    }))
  );

  // Calculate total width based on agents
  const columnWidth = 200;
  const addButtonWidth = 160;
  const totalWidth = agents.length > 0
    ? agents.reduce((sum, agent) => sum + agent.outputs.length * columnWidth, 0) + addButtonWidth
    : addButtonWidth + 100;

  const hasAgents = agents.length > 0;

  return (
    <VStack
      gap={0}
      minWidth={`${totalWidth}px`}
      borderRight="2px solid"
      borderColor="gray.300"
      flexShrink={0}
    >
      {/* Super Header */}
      <SuperHeader title="Agents" colorScheme="purple" minWidth={`${totalWidth}px`}>
        {hasAgents && (
          <Tooltip content="Add comparison agent">
            <Button
              variant="ghost"
              size="xs"
              colorPalette="purple"
              onClick={() => setActiveModal({ type: "add-agent" })}
            >
              <LuPlus size={12} />
              Add Comparison
            </Button>
          </Tooltip>
        )}
      </SuperHeader>

      {/* Column Headers */}
      <HStack gap={0} width="full">
        {!hasAgents ? (
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
              colorPalette="purple"
              onClick={() => setActiveModal({ type: "add-agent" })}
            >
              <LuPlus size={14} />
              Add Agent
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
          agents.map((agent) => (
            <AgentColumnHeaders
              key={agent.id}
              agent={agent}
              columnWidth={columnWidth}
              hasUnmappedInputs={getUnmappedAgentInputs(agent.id).length > 0}
              onEdit={() => setActiveModal({ type: "edit-agent", agentId: agent.id })}
              onMapInputs={() => setActiveModal({ type: "agent-mapping", agentId: agent.id })}
            />
          ))
        )}
        {hasAgents && (
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
          {!hasAgents ? (
            <Box
              height="40px"
              width={`${addButtonWidth + 100}px`}
              background={rowIndex % 2 === 0 ? "white" : "gray.50"}
              borderBottom="1px solid"
              borderColor="gray.100"
            />
          ) : (
            agents.map((agent) => (
              <AgentResultCells
                key={agent.id}
                agent={agent}
                rowIndex={rowIndex}
                columnWidth={columnWidth}
                result={currentRun?.agentResults.find(
                  (r) => r.agentId === agent.id && r.rowIndex === rowIndex
                )}
                isRunning={currentRun?.status === "running"}
              />
            ))
          )}
          {hasAgents && (
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
 * Agent Column Headers
 */
function AgentColumnHeaders({
  agent,
  columnWidth,
  hasUnmappedInputs,
  onEdit,
  onMapInputs,
}: {
  agent: Agent;
  columnWidth: number;
  hasUnmappedInputs: boolean;
  onEdit: () => void;
  onMapInputs: () => void;
}) {
  const AgentIcon = agent.type === "llm" ? LuBrain : LuCode;

  return (
    <Box>
      {/* Agent name header spanning all outputs */}
      <HStack
        height="36px"
        minWidth={`${agent.outputs.length * columnWidth}px`}
        background="purple.50"
        borderBottom="1px solid"
        borderColor="purple.200"
        paddingX={2}
        gap={2}
      >
        <AgentIcon size={14} color="var(--chakra-colors-purple-600)" />
        <Text
          fontSize="xs"
          fontWeight="medium"
          color="purple.700"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
          flex={1}
        >
          {agent.name}
        </Text>
        {agent.type === "llm" && (
          <Text fontSize="xs" color="purple.500">
            {agent.model.split("/").pop()}
          </Text>
        )}
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
        <Tooltip content="Edit agent settings">
          <IconButton
            aria-label="Edit agent"
            variant="ghost"
            size="xs"
            colorPalette="purple"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <LuSettings size={14} />
          </IconButton>
        </Tooltip>
      </HStack>
      {/* Output column headers */}
      <HStack gap={0}>
        {agent.outputs.map((output) => (
          <ColumnHeader
            key={output.identifier}
            title={output.identifier}
            width={`${columnWidth}px`}
          />
        ))}
      </HStack>
    </Box>
  );
}

/**
 * Agent Result Cells
 */
function AgentResultCells({
  agent,
  rowIndex,
  columnWidth,
  result,
  isRunning,
}: {
  agent: Agent;
  rowIndex: number;
  columnWidth: number;
  result?: {
    outputs: Record<string, unknown>;
    error?: string;
    cost?: number;
    duration?: number;
  };
  isRunning: boolean;
}) {
  return (
    <>
      {agent.outputs.map((output) => {
        const value = result?.outputs?.[output.identifier];
        const hasError = !!result?.error;
        const isPending = !result && isRunning;

        let status: "success" | "error" | "running" | "pending" | undefined;
        if (hasError) status = "error";
        else if (isPending) status = "running";
        else if (result) status = "success";

        return (
          <Box
            key={output.identifier}
            height="40px"
            width={`${columnWidth}px`}
            minWidth={`${columnWidth}px`}
            background={
              hasError
                ? "red.50"
                : isPending
                  ? "blue.50"
                  : rowIndex % 2 === 0
                    ? "white"
                    : "gray.50"
            }
            borderBottom="1px solid"
            borderColor="gray.100"
            borderRight="1px solid"
            borderRightColor="gray.200"
            display="flex"
            alignItems="center"
            paddingX={2}
            gap={1}
          >
            {isPending ? (
              <Spinner size="xs" color="blue.400" />
            ) : hasError ? (
              <Tooltip content={result?.error}>
                <Text fontSize="sm" color="red.600" lineClamp={1}>
                  Error
                </Text>
              </Tooltip>
            ) : result ? (
              <Text
                fontSize="sm"
                color="gray.800"
                overflow="hidden"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
              >
                {typeof value === "object"
                  ? JSON.stringify(value)
                  : value !== undefined
                    ? String(value)
                    : ""}
              </Text>
            ) : null}
          </Box>
        );
      })}
    </>
  );
}

