import { memo, useCallback, useRef, useEffect } from "react";
import { PromptEditorDrawer } from "~/components/prompts/PromptEditorDrawer";
import { useDrawer, useDrawerParams, getComplexProps } from "~/hooks/useDrawer";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import type { LocalPromptConfig } from "../types";

type PromptEditorDrawerHandlerProps = {
  runnerId?: string;
  isOpen: boolean;
  onSelectPrompt: (prompt: { id: string; name: string; versionId?: string }) => void;
};

/**
 * Handler component that manages local config state for PromptEditorDrawer.
 * Rendered outside the main table to prevent re-renders when local config changes.
 *
 * This component:
 * - Gets runner data from Zustand store based on URL params
 * - Captures initial local config once when drawer opens
 * - Provides callbacks to update local config in the store
 * - Doesn't cause table re-renders because it's rendered separately
 */
export const PromptEditorDrawerHandler = memo(
  function PromptEditorDrawerHandler({
    runnerId,
    isOpen,
    onSelectPrompt,
  }: PromptEditorDrawerHandlerProps) {
    const { closeDrawer } = useDrawer();
    const drawerParams = useDrawerParams();
    const complexProps = getComplexProps();

    // Get updateRunner action (stable reference)
    const updateRunner = useEvaluationsV3Store((state) => state.updateRunner);

    // Determine the runner ID from props or URL params
    const effectiveRunnerId = runnerId ?? drawerParams.runnerId;

    // Get prompt ID from URL params
    const promptId = drawerParams.promptId as string | undefined;

    // Get initial local config only once when drawer opens
    // Store it in a ref so it doesn't change and cause re-renders
    const initialLocalConfigRef = useRef<LocalPromptConfig | undefined>(undefined);
    const wasOpenRef = useRef(false);

    // Capture initial config when drawer opens
    useEffect(() => {
      if (isOpen && !wasOpenRef.current && effectiveRunnerId) {
        const state = useEvaluationsV3Store.getState();
        const runner = state.runners.find((r) => r.id === effectiveRunnerId);
        if (runner?.type === "prompt") {
          initialLocalConfigRef.current = runner.localPromptConfig;
        }
        wasOpenRef.current = true;
      } else if (!isOpen && wasOpenRef.current) {
        // Reset when drawer closes
        initialLocalConfigRef.current = undefined;
        wasOpenRef.current = false;
      }
    }, [isOpen, effectiveRunnerId]);

    // Memoized callback to update local config
    const handleLocalConfigChange = useCallback(
      (localConfig: LocalPromptConfig | undefined) => {
        if (effectiveRunnerId) {
          updateRunner(effectiveRunnerId, { localPromptConfig: localConfig });
        }
      },
      [effectiveRunnerId, updateRunner],
    );

    // Memoized callback for saving
    const handleSave = useCallback(
      (savedPrompt: { id: string; name: string; versionId?: string }) => {
        if (effectiveRunnerId) {
          // Update existing runner and clear local config
          updateRunner(effectiveRunnerId, {
            name: savedPrompt.name,
            promptId: savedPrompt.id,
            localPromptConfig: undefined,
          });
          closeDrawer();
        } else {
          // Create new runner via parent callback
          onSelectPrompt(savedPrompt);
        }
      },
      [effectiveRunnerId, updateRunner, closeDrawer, onSelectPrompt],
    );

    // Only render when the drawer is open
    if (!isOpen) {
      return null;
    }

    return (
      <PromptEditorDrawer
        open={isOpen}
        onClose={closeDrawer}
        promptId={promptId}
        initialLocalConfig={initialLocalConfigRef.current}
        onLocalConfigChange={effectiveRunnerId ? handleLocalConfigChange : undefined}
        onSave={handleSave}
      />
    );
  },
);
