import { Box, HStack, Spinner, Text } from "@chakra-ui/react";
import { hasDSLChanged, type StudioWorkflow } from "@langwatch/workflow-contract";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { Check, X } from "react-feather";
import { useShallow } from "zustand/react/shallow";

import { useWorkflowStore } from "../../behavior/use-workflow-store.ts";
import { serializeWorkflow } from "../../behavior/workflow-store.ts";

type WorkflowAutosaveResult = { version: string; id: string };
type TimerRef = RefObject<ReturnType<typeof setTimeout> | undefined>;

function clearTimer(ref: TimerRef) {
  if (ref.current) clearTimeout(ref.current);
  ref.current = undefined;
}

/** The write succeeded; the baseline moves only once the version list refreshed. */
async function refreshThenMoveBaseline({
  onRefreshVersions,
  moveBaseline,
}: {
  onRefreshVersions: () => Promise<void>;
  moveBaseline: () => void;
}) {
  try {
    await onRefreshVersions();
    moveBaseline();
  } catch (error) {
    void error;
  }
}

/**
 * Browser-side Workflow autosave. The application provides the two transport
 * actions while this component owns change detection, debounce, and status UI.
 */
export function WorkflowAutosave({
  isWorkflowReady,
  onSave,
  onRefreshVersions,
}: {
  isWorkflowReady: boolean;
  onSave: (input: {
    dsl: StudioWorkflow;
    setAsLatestVersion: boolean;
  }) => Promise<WorkflowAutosaveResult>;
  onRefreshVersions: () => Promise<void>;
}) {
  const [recentlySaved, setRecentlySaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasSaveError, setHasSaveError] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const maxWaitTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedIndicatorTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const {
    setWorkflow,
    setAutosavedWorkflow,
    hasPendingChanges,
    getWorkflow,
    getAutosavedWorkflow,
    setCurrentVersionId,
  } = useWorkflowStore(
    ({
      setWorkflow,
      setAutosavedWorkflow,
      hasPendingChanges,
      getWorkflow,
      getAutosavedWorkflow,
      setCurrentVersionId,
    }) => ({
      setWorkflow,
      setAutosavedWorkflow,
      hasPendingChanges,
      getWorkflow,
      getAutosavedWorkflow,
      setCurrentVersionId,
    }),
  );
  const stateWorkflow = useWorkflowStore(useShallow((state) => state.getWorkflow()));

  const clearScheduledSave = useCallback(() => {
    clearTimer(saveTimeoutRef);
    clearTimer(maxWaitTimeoutRef);
  }, []);

  const saveIfChanged = useCallback(async () => {
    clearScheduledSave();
    if (!isWorkflowReady) {
      return;
    }

    const currentWorkflow = getWorkflow();
    if (!hasPendingChanges()) {
      setAutosavedWorkflow(currentWorkflow);
      return;
    }

    const autosavedWorkflow = getAutosavedWorkflow();
    if (!autosavedWorkflow) {
      return;
    }

    const setAsLatestVersion = hasDSLChanged(autosavedWorkflow, currentWorkflow, false);
    setIsSaving(true);
    setHasSaveError(false);

    try {
      const saved = await onSave({
        dsl: serializeWorkflow(currentWorkflow),
        setAsLatestVersion,
      });
      if (saved.version !== currentWorkflow.version) {
        setWorkflow({ version: saved.version });
      }
      setCurrentVersionId(saved.id);
      setRecentlySaved(true);
      clearTimer(savedIndicatorTimeoutRef);
      savedIndicatorTimeoutRef.current = setTimeout(() => setRecentlySaved(false), 5000);
      await refreshThenMoveBaseline({
        onRefreshVersions,
        moveBaseline: () => setAutosavedWorkflow(currentWorkflow),
      });
    } catch {
      setHasSaveError(true);
    } finally {
      setIsSaving(false);
    }
  }, [
    clearScheduledSave,
    getAutosavedWorkflow,
    getWorkflow,
    hasPendingChanges,
    isWorkflowReady,
    onRefreshVersions,
    onSave,
    setAutosavedWorkflow,
    setCurrentVersionId,
    setWorkflow,
  ]);

  useEffect(() => {
    if (!isWorkflowReady) {
      clearScheduledSave();
      return;
    }

    clearTimer(saveTimeoutRef);
    saveTimeoutRef.current = setTimeout(() => void saveIfChanged(), 1000);

    if (!maxWaitTimeoutRef.current) {
      maxWaitTimeoutRef.current = setTimeout(() => void saveIfChanged(), 30_000);
    }

    return () => clearTimer(saveTimeoutRef);
  }, [clearScheduledSave, isWorkflowReady, saveIfChanged, stateWorkflow]);

  useEffect(
    () => () => {
      clearScheduledSave();
      clearTimer(savedIndicatorTimeoutRef);
    },
    [clearScheduledSave],
  );

  return (
    <AutosaveStatus isSaving={isSaving} hasSaveError={hasSaveError} recentlySaved={recentlySaved} />
  );
}

function AutosaveStatus({
  isSaving,
  hasSaveError,
  recentlySaved,
}: {
  isSaving: boolean;
  hasSaveError: boolean;
  recentlySaved: boolean;
}) {
  const showSaveError = !isSaving && hasSaveError;
  const showSaved = !isSaving && !hasSaveError && recentlySaved;

  return (
    <Box paddingLeft={2}>
      {isSaving && (
        <HStack>
          <Spinner size="xs" />
          <Text fontSize="13px">Saving...</Text>
        </HStack>
      )}
      {showSaveError && (
        <HStack color="status.error">
          <X size={16} />
          <Text fontSize="13px">Failed to autosave</Text>
        </HStack>
      )}
      {showSaved && (
        <HStack>
          <Box color="status.success">
            <Check width="16px" height="16px" />
          </Box>
          <Text fontSize="13px">Saved</Text>
        </HStack>
      )}
    </Box>
  );
}
