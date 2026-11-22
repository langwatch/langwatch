import { Box, HStack, Spinner, Text } from "@langwatch/design-system/primitives";
import { hasDSLChanged, type StudioWorkflow } from "@langwatch/workflow-contract";
import { Check } from "lucide-react";
import { type RefObject, useEffect, useEffectEvent, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useWorkflowStore } from "../../behavior/use-workflow-store.ts";
import { serializeWorkflow } from "../../behavior/workflow-store.ts";

type WorkflowAutosaveResult = { version: string; id: string };
type TimerRef = RefObject<ReturnType<typeof setTimeout> | undefined>;

/** A save that did not go through waits this long, doubling to the cap, then tries again. */
const RETRY_FIRST_MS = 5_000;
const RETRY_MAX_MS = 60_000;

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
 * Browser-side Workflow autosave: the application provides the two transport actions,
 * this owns change detection, debounce and status. Saves go to the API whatever the engine
 * connection; a save that does not go through stays queued and retries, never failing.
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
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const maxWaitTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedIndicatorTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryDelayRef = useRef(RETRY_FIRST_MS);

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

  const clearScheduledSave = useEffectEvent(() => {
    clearTimer(saveTimeoutRef);
    clearTimer(maxWaitTimeoutRef);
    clearTimer(retryTimeoutRef);
  });

  const saveIfChanged = useEffectEvent(async () => {
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

    try {
      const saved = await onSave({
        dsl: serializeWorkflow(currentWorkflow),
        setAsLatestVersion,
      });
      if (saved.version !== currentWorkflow.version) {
        setWorkflow({ version: saved.version });
      }
      setCurrentVersionId(saved.id);
      retryDelayRef.current = RETRY_FIRST_MS;
      setRecentlySaved(true);
      clearTimer(savedIndicatorTimeoutRef);
      savedIndicatorTimeoutRef.current = setTimeout(() => setRecentlySaved(false), 5000);
      await refreshThenMoveBaseline({
        onRefreshVersions,
        moveBaseline: () => setAutosavedWorkflow(currentWorkflow),
      });
    } catch {
      // Still queued: the baseline did not move, so the next attempt sends the same change.
      const delay = retryDelayRef.current;
      retryDelayRef.current = Math.min(delay * 2, RETRY_MAX_MS);
      retryTimeoutRef.current = setTimeout(() => void saveIfChanged(), delay);
    } finally {
      setIsSaving(false);
    }
  });

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
  }, [isWorkflowReady, stateWorkflow]);

  useEffect(
    () => () => {
      clearScheduledSave();
      clearTimer(savedIndicatorTimeoutRef);
    },
    [],
  );

  return <AutosaveStatus isSaving={isSaving} recentlySaved={recentlySaved} />;
}

function AutosaveStatus({
  isSaving,
  recentlySaved,
}: {
  isSaving: boolean;
  recentlySaved: boolean;
}) {
  const showSaved = !isSaving && recentlySaved;

  return (
    <Box paddingLeft={2}>
      {isSaving && (
        <HStack>
          <Spinner size="xs" />
          <Text textStyle="bodySm">Saving...</Text>
        </HStack>
      )}
      {showSaved && (
        <HStack>
          <Box color="status.success">
            <Check width="16px" height="16px" />
          </Box>
          <Text textStyle="bodySm">Saved</Text>
        </HStack>
      )}
    </Box>
  );
}
