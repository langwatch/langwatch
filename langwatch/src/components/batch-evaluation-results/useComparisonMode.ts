/**
 * useComparisonMode - Hook for managing comparison mode state
 *
 * Handles:
 * - Entering/exiting compare mode
 * - Selecting/deselecting runs for comparison
 * - Auto-selecting runs when entering compare mode
 * - Enforcing minimum selection (at least 2 runs)
 */
import { useState, useCallback, useMemo } from "react";

type UseComparisonModeOptions = {
  /** All available run IDs */
  runIds: string[];
  /** Currently viewed run ID (for auto-selection) */
  currentRunId?: string;
};

type UseComparisonModeReturn = {
  /** Whether compare mode is active */
  compareMode: boolean;
  /** Currently selected run IDs for comparison */
  selectedRunIds: string[];
  /** Toggle compare mode on/off */
  toggleCompareMode: () => void;
  /** Toggle selection of a specific run */
  toggleRunSelection: (runId: string) => void;
  /** Check if a run can be deselected (enforces min 1) */
  canDeselectRun: (runId: string) => boolean;
  /** Whether comparison is possible (2+ runs available) */
  canCompare: boolean;
  /** Enter compare mode with specific runs selected */
  enterCompareWithRuns: (runId1: string, runId2: string) => void;
};

export const useComparisonMode = ({
  runIds,
  currentRunId,
}: UseComparisonModeOptions): UseComparisonModeReturn => {
  const [compareMode, setCompareMode] = useState(false);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);

  const canCompare = runIds.length >= 2;

  const toggleCompareMode = useCallback(() => {
    setCompareMode((prev) => {
      if (!prev) {
        // Entering compare mode - auto-select current run + next one
        const currentIndex = currentRunId
          ? runIds.indexOf(currentRunId)
          : 0;
        const firstRunId = runIds[currentIndex] ?? runIds[0];
        const secondRunId =
          runIds[currentIndex + 1] ?? runIds[currentIndex - 1] ?? runIds[1];

        const initialSelection = [firstRunId, secondRunId].filter(
          (id): id is string => !!id
        );

        // Ensure we have at least 2 unique runs
        const uniqueSelection = [...new Set(initialSelection)];
        setSelectedRunIds(uniqueSelection.length >= 2 ? uniqueSelection : runIds.slice(0, 2));

        return true;
      } else {
        // Exiting compare mode - clear selection
        setSelectedRunIds([]);
        return false;
      }
    });
  }, [currentRunId, runIds]);

  const toggleRunSelection = useCallback((runId: string) => {
    setSelectedRunIds((prev) => {
      const isSelected = prev.includes(runId);

      if (isSelected) {
        // If deselecting the last run, exit compare mode
        if (prev.length <= 1) {
          setCompareMode(false);
          return [];
        }
        return prev.filter((id) => id !== runId);
      } else {
        return [...prev, runId];
      }
    });
  }, []);

  const canDeselectRun = useCallback(
    (runId: string) => {
      if (!selectedRunIds.includes(runId)) return false;
      return selectedRunIds.length > 1;
    },
    [selectedRunIds]
  );

  const enterCompareWithRuns = useCallback((runId1: string, runId2: string) => {
    setCompareMode(true);
    setSelectedRunIds([runId1, runId2]);
  }, []);

  return {
    compareMode,
    selectedRunIds,
    toggleCompareMode,
    toggleRunSelection,
    canDeselectRun,
    canCompare,
    enterCompareWithRuns,
  };
};
