import { Box, HStack, Spinner, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, X } from "react-feather";
import { useShallow } from "zustand/react/shallow";

import { hasDSLChanged, type StudioWorkflow } from "@langwatch/workflow-contract";
import { useWorkflowStore } from "../../behavior/use-workflow-store";
import { serializeWorkflow } from "../../behavior/workflow-store";

type WorkflowAutosaveResult = { version: string; id: string };

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
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = undefined;
    }
    if (maxWaitTimeoutRef.current) {
      clearTimeout(maxWaitTimeoutRef.current);
      maxWaitTimeoutRef.current = undefined;
    }
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
      if (savedIndicatorTimeoutRef.current) {
        clearTimeout(savedIndicatorTimeoutRef.current);
      }
      savedIndicatorTimeoutRef.current = setTimeout(() => setRecentlySaved(false), 5000);

      try {
        await onRefreshVersions();
        setAutosavedWorkflow(currentWorkflow);
      } catch {
        // The write succeeded. Keep the pending-change baseline unchanged until
        // the version list can be refreshed, matching the previous transport flow.
      }
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

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => void saveIfChanged(), 1000);

    if (!maxWaitTimeoutRef.current) {
      maxWaitTimeoutRef.current = setTimeout(() => void saveIfChanged(), 30_000);
    }

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = undefined;
      }
    };
  }, [clearScheduledSave, isWorkflowReady, saveIfChanged, stateWorkflow]);

  useEffect(
    () => () => {
      clearScheduledSave();
      if (savedIndicatorTimeoutRef.current) {
        clearTimeout(savedIndicatorTimeoutRef.current);
      }
    },
    [clearScheduledSave],
  );

  return (
    <Box paddingLeft={2}>
      {isSaving ? (
        <HStack>
          <Spinner size="xs" />
          <Text fontSize="13px">Saving...</Text>
        </HStack>
      ) : hasSaveError ? (
        <HStack color="status.error">
          <X size={16} />
          <Text fontSize="13px">Failed to autosave</Text>
        </HStack>
      ) : recentlySaved ? (
        <HStack>
          <Box color="status.success">
            <Check width="16px" height="16px" />
          </Box>
          <Text fontSize="13px">Saved</Text>
        </HStack>
      ) : null}
    </Box>
  );
}
