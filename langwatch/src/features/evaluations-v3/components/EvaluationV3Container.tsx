/**
 * Evaluation V3 Container
 *
 * Main container component for the spreadsheet-based evaluation experience.
 */

import {
  Box,
  Button,
  HStack,
  IconButton,
  Input,
  Progress,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useShallow } from "zustand/react/shallow";
import {
  LuHistory,
  LuPlay,
  LuRedo2,
  LuUndo2,
} from "react-icons/lu";
import { useEvaluationV3Store, useEvaluationV3Undo } from "../store/useEvaluationV3Store";
import { EvaluationSpreadsheet } from "./spreadsheet/EvaluationSpreadsheet";
import { Tooltip } from "../../../components/ui/tooltip";
import { useAutosaveV3 } from "../hooks/useAutosaveV3";
import { useRunEvaluationV3 } from "../hooks/useRunEvaluationV3";
import { useEvaluationEventsV3 } from "../hooks/useEvaluationEventsV3";
import { AddAgentModal } from "./modals/AddAgentModal";
import { AddEvaluatorModal } from "./modals/AddEvaluatorModal";
import { AgentMappingModal } from "./modals/AgentMappingModal";
import { EvaluatorMappingModal } from "./modals/EvaluatorMappingModal";
import { HistoryPanel } from "./header/HistoryPanel";
import { useState, useEffect, useCallback } from "react";
import { LuSquare } from "react-icons/lu";

export function EvaluationV3Container() {
  const {
    name,
    isAutosaving,
    activeModal,
    setName,
    setActiveModal,
    hasRequiredConfiguration,
    currentRun,
  } = useEvaluationV3Store(
    useShallow((s) => ({
      name: s.name,
      isAutosaving: s.isAutosaving,
      activeModal: s.activeModal,
      setName: s.setName,
      setActiveModal: s.setActiveModal,
      hasRequiredConfiguration: s.hasRequiredConfiguration,
      currentRun: s.currentRun,
    }))
  );

  const { undo, redo, canUndo, canRedo } = useEvaluationV3Undo();
  const [showHistory, setShowHistory] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(name);

  // Autosave hook
  useAutosaveV3();

  // Evaluation execution hook
  const { runEvaluation, stopEvaluation, isLoading } = useRunEvaluationV3();

  // Evaluation events hook (polls for results)
  useEvaluationEventsV3();

  const isRunning = currentRun?.status === "running";
  const canEvaluate = hasRequiredConfiguration() && !isRunning;

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo: Ctrl/Cmd + Z
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (canUndo) undo();
      }
      // Redo: Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        if (canRedo) redo();
      }
      // Run evaluation: Ctrl/Cmd + Enter (when not editing)
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !isEditingName) {
        e.preventDefault();
        if (canEvaluate) {
          void runEvaluation();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canUndo, canRedo, undo, redo, canEvaluate, isEditingName, runEvaluation]);

  const handleStartEvaluation = () => {
    void runEvaluation();
  };

  const handleStopEvaluation = () => {
    stopEvaluation();
  };

  return (
    <Box width="full" height="full" position="relative">
      {/* Header */}
      <HStack
        width="full"
        paddingX={6}
        paddingY={3}
        background="white"
        borderBottom="1px solid"
        borderColor="gray.200"
        gap={4}
      >
        {/* Name */}
        {isEditingName ? (
          <Input
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
            onBlur={() => {
              setName(tempName);
              setIsEditingName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setName(tempName);
                setIsEditingName(false);
              }
              if (e.key === "Escape") {
                setTempName(name);
                setIsEditingName(false);
              }
            }}
            autoFocus
            size="sm"
            width="200px"
            fontWeight="medium"
          />
        ) : (
          <Text
            fontSize="md"
            fontWeight="medium"
            cursor="pointer"
            onClick={() => {
              setTempName(name);
              setIsEditingName(true);
            }}
            _hover={{ color: "blue.500" }}
          >
            {name}
          </Text>
        )}

        {/* Autosave indicator */}
        {isAutosaving && (
          <HStack gap={1} color="gray.500">
            <Spinner size="xs" />
            <Text fontSize="xs">Saving...</Text>
          </HStack>
        )}

        <Spacer />

        {/* Undo/Redo */}
        <HStack gap={1}>
          <Tooltip content="Undo (Ctrl+Z)">
            <IconButton
              aria-label="Undo"
              variant="ghost"
              size="sm"
              onClick={() => undo()}
              disabled={!canUndo}
            >
              <LuUndo2 />
            </IconButton>
          </Tooltip>
          <Tooltip content="Redo (Ctrl+Shift+Z)">
            <IconButton
              aria-label="Redo"
              variant="ghost"
              size="sm"
              onClick={() => redo()}
              disabled={!canRedo}
            >
              <LuRedo2 />
            </IconButton>
          </Tooltip>
        </HStack>

        {/* History */}
        <Tooltip content="View run history">
          <IconButton
            aria-label="History"
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
          >
            <LuHistory />
          </IconButton>
        </Tooltip>

        {/* Evaluate Button */}
        {isRunning ? (
          <Button
            colorPalette="red"
            size="sm"
            onClick={handleStopEvaluation}
          >
            <LuSquare />
            Stop
          </Button>
        ) : (
          <Tooltip
            content={
              !canEvaluate
                ? "Add at least one agent and one evaluator to run"
                : "Run evaluation on all dataset rows"
            }
          >
            <Button
              colorPalette="green"
              size="sm"
              onClick={handleStartEvaluation}
              disabled={!canEvaluate}
              loading={isLoading}
            >
              <LuPlay />
              Evaluate
            </Button>
          </Tooltip>
        )}
      </HStack>

      {/* Progress Bar */}
      {isRunning && currentRun && (
        <Box width="full" paddingX={6} paddingY={2} background="blue.50">
          <HStack gap={4}>
            <Text fontSize="sm" color="blue.700" fontWeight="medium">
              Running evaluation...
            </Text>
            <Progress.Root
              value={currentRun.total > 0 ? (currentRun.progress / currentRun.total) * 100 : 0}
              size="sm"
              colorPalette="blue"
              flex={1}
            >
              <Progress.Track>
                <Progress.Range />
              </Progress.Track>
            </Progress.Root>
            <Text fontSize="sm" color="blue.600">
              {currentRun.progress}/{currentRun.total}
            </Text>
          </HStack>
        </Box>
      )}

      {/* Main Content */}
      <HStack width="full" height="calc(100% - 57px)" align="stretch" gap={0}>
        {/* Spreadsheet */}
        <Box flex={1} overflow="auto">
          <EvaluationSpreadsheet />
        </Box>

        {/* History Panel */}
        {showHistory && (
          <HistoryPanel onClose={() => setShowHistory(false)} />
        )}
      </HStack>

      {/* Modals */}
      {activeModal?.type === "add-agent" && (
        <AddAgentModal onClose={() => setActiveModal(null)} />
      )}
      {activeModal?.type === "edit-agent" && (
        <AddAgentModal
          agentId={activeModal.agentId}
          onClose={() => setActiveModal(null)}
        />
      )}
      {activeModal?.type === "add-evaluator" && (
        <AddEvaluatorModal onClose={() => setActiveModal(null)} />
      )}
      {activeModal?.type === "edit-evaluator" && (
        <AddEvaluatorModal
          evaluatorId={activeModal.evaluatorId}
          onClose={() => setActiveModal(null)}
        />
      )}
      {activeModal?.type === "agent-mapping" && (
        <AgentMappingModal
          agentId={activeModal.agentId}
          onClose={() => setActiveModal(null)}
        />
      )}
      {activeModal?.type === "evaluator-mapping" && (
        <EvaluatorMappingModal
          evaluatorId={activeModal.evaluatorId}
          onClose={() => setActiveModal(null)}
        />
      )}
    </Box>
  );
}

