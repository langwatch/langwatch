import type { AgentWithFields } from "@langwatch/agent-contract";
import {
  getFlowCallbacks,
  setComplexProps,
  setFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "@langwatch/browser-host/drawer";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { api } from "@langwatch/browser-trpc/workflow-api";
import { evaluatorHasMissingMappings } from "@langwatch/experiment-contract/mapping-validation";
import type { FieldMapping as UIFieldMapping } from "@langwatch/prompt-browser-kit";
import { useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import { createEvaluatorEditorCallbacks } from "../../model/experiments-v3/evaluator-editor-callbacks.ts";
import { createPromptEditorCallbacks } from "../../model/experiments-v3/prompt-editor-callbacks.ts";
import { resolveTargetNameFromCache } from "../../model/experiments-v3/resolve-target-name.ts";
import {
  type EvaluatorWithFields,
  evaluatorTargetConfig,
  comparisonContextOf,
  type PickedPrompt,
  reloadedComparisonContext,
  promptTargetConfig,
  type SavedPrompt,
  savedAgentTargetConfig,
  savedPromptTargetConfig,
  workbenchEvaluatorConfig,
} from "../../model/experiments-v3/target-configs.ts";
import type { ComparisonEvaluatorConfig, TargetConfig } from "../../model/experiments-v3/types.ts";
import {
  COMPARISON_EVALUATOR_TYPE,
  LEGACY_PAIRWISE_EVALUATOR_TYPE,
} from "../../model/experiments-v3/types.ts";
import { useEvaluationsV3Store } from "./use-evaluations-v3-store.ts";
import { useOpenEvaluatorEditor } from "./use-open-evaluator-editor.ts";
import { scrollToTargetColumn, useOpenTargetEditor } from "./use-open-target-editor.ts";

/** The picker a switched target reopens, by the kind of target it replaces. */
const SWITCH_DRAWERS = {
  prompt: "promptList",
  agent: "agentList",
  evaluator: "evaluatorList",
} as const satisfies Record<Exclude<TargetConfig["type"], "workflow">, string>;

/** Collects a not-yet-created prompt's mapping edits into `pending.current`, keyed by input. */
const recordPendingMapping =
  (pending: { current: Record<string, UIFieldMapping> }) =>
  (identifier: string, mapping: UIFieldMapping | undefined): void => {
    if (mapping) {
      pending.current[identifier] = mapping;
    } else {
      delete pending.current[identifier];
    }
  };

/**
 * What picking a target does: add it (or replace the one being switched), and the
 * drafts a flow collects before its target exists.
 */
export const useWorkbenchTargetSelection = () => {
  const { openDrawer, closeDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();
  const trpcUtils = api.useUtils();
  const { addTarget, removeTarget, updateTarget, setTargetMapping, removeTargetMapping } =
    useEvaluationsV3Store(
      useShallow((state) => ({
        addTarget: state.addTarget,
        removeTarget: state.removeTarget,
        updateTarget: state.updateTarget,
        setTargetMapping: state.setTargetMapping,
        removeTargetMapping: state.removeTargetMapping,
      })),
    );
  const { openTargetEditor } = useOpenTargetEditor();
  // Track pending mappings for new prompts (before they become targets)
  const pendingMappingsRef = useRef<Record<string, UIFieldMapping>>({});

  // Track variant selections made inside the creation evaluatorEditor so
  // handleSelectEvaluatorAsTarget can apply them on save instead of empty defaults.
  const pendingComparisonRef = useRef<ComparisonEvaluatorConfig | null>(null);

  // Track target being switched (null when adding new, target ID when switching)
  const switchingTargetIdRef = useRef<string | null>(null);

  // Wrapper that handles both add and replace (for switch functionality)
  const addOrReplaceTarget = useCallback(
    (targetConfig: TargetConfig) => {
      if (switchingTargetIdRef.current) {
        // Switch mode: remove old target first, then add new one
        removeTarget(switchingTargetIdRef.current);
        switchingTargetIdRef.current = null;
      }
      addTarget(targetConfig);
    },
    [addTarget, removeTarget],
  );

  // Handler for when a saved agent is selected from the drawer
  const handleSelectSavedAgent = useCallback(
    (savedAgent: AgentWithFields) => {
      addOrReplaceTarget(savedAgentTargetConfig(savedAgent));
      closeDrawer();
    },
    [addOrReplaceTarget, closeDrawer],
  );

  // Handler for when an evaluator is selected as a target from the drawer
  // Uses pre-computed fields from the API (includes type and optional flag)
  const handleSelectEvaluatorAsTarget = useCallback(
    (evaluator: EvaluatorWithFields) => {
      const { targetConfig, needsConfiguration } = evaluatorTargetConfig({
        evaluator,
        pendingComparison: pendingComparisonRef.current,
      });
      pendingComparisonRef.current = null;
      addOrReplaceTarget(targetConfig);
      // An unconfigured comparison opens its form (openTargetEditor reads fresh
      // store state, so the new column is there); anything else just closes.
      if (needsConfiguration) {
        void openTargetEditor(targetConfig);
      } else {
        closeDrawer();
      }
    },
    [addOrReplaceTarget, closeDrawer, openTargetEditor],
  );

  // Handler for when a prompt is selected from the drawer
  // Adds the target and immediately opens the prompt editor for configuration
  const handleSelectPrompt = useCallback(
    (prompt: PickedPrompt) => {
      const targetConfig = promptTargetConfig(prompt);
      const targetId = targetConfig.id;
      // addOrReplaceTarget will auto-map based on the real inputs (and handle switch mode)
      addOrReplaceTarget(targetConfig);

      // Set up flow callbacks for the prompt editor using the centralized helper
      // This ensures we never forget a required callback
      setFlowCallbacks(
        "promptEditor",
        createPromptEditorCallbacks({
          targetId,
          updateTarget,
          setTargetMapping,
          removeTargetMapping,
          getActiveDatasetId: () => useEvaluationsV3Store.getState().activeDatasetId,
          getDatasets: () => useEvaluationsV3Store.getState().datasets,
        }),
      );

      // Open the prompt editor drawer for the newly added target
      // Reset stack to prevent back button when switching between targets
      openDrawer(
        "promptEditor",
        {
          promptId: prompt.id,
          urlParams: { targetId },
        },
        { resetStack: true },
      );

      // Scroll to position the target column next to the drawer
      // Use requestAnimationFrame to ensure the drawer has started opening
      requestAnimationFrame(() => {
        scrollToTargetColumn(targetId);
      });
    },
    [addOrReplaceTarget, openDrawer, updateTarget, setTargetMapping, removeTargetMapping],
  );

  // Extracted so BOTH the Add→Comparison flow and the reload re-hydration
  // effect register the exact same evaluatorEditor callbacks. onSave fetches the
  // freshly-created evaluator and adds it as a target column; onComparisonChange
  // mirrors the live draft into pendingComparisonRef (also lifts `isComparison`
  // to true in EvaluatorEditorShared so ComparisonConfigForm renders).
  const handleComparisonEvaluatorSave = useCallback(
    async (savedEvaluator: { id: string; name: string }) => {
      const evaluator = await trpcUtils.evaluators.getById.fetch({
        id: savedEvaluator.id,
        projectId: project?.id ?? "",
      });
      if (!evaluator) {
        closeDrawer();
        return true;
      }
      handleSelectEvaluatorAsTarget(evaluator);
      return true;
    },
    [trpcUtils.evaluators.getById, project?.id, closeDrawer, handleSelectEvaluatorAsTarget],
  );
  const handlePendingComparisonChange = useCallback((next: ComparisonEvaluatorConfig) => {
    pendingComparisonRef.current = next;
  }, []);

  return {
    pendingMappingsRef,
    pendingComparisonRef,
    switchingTargetIdRef,
    addOrReplaceTarget,
    handleSelectSavedAgent,
    handleSelectEvaluatorAsTarget,
    handleSelectPrompt,
    handleComparisonEvaluatorSave,
    handlePendingComparisonChange,
  };
};

/** Adding an evaluator to every target, then guiding the reader to any unmapped field. */
export const useWorkbenchEvaluatorAdd = () => {
  const { openDrawer, closeDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();
  const trpcUtils = api.useUtils();
  const { evaluators, addEvaluator } = useEvaluationsV3Store(
    useShallow((state) => ({
      evaluators: state.evaluators,
      addEvaluator: state.addEvaluator,
    })),
  );
  const openEvaluatorEditor = useOpenEvaluatorEditor();
  /**
   * Helper to add an evaluator to the workbench from an EvaluatorWithFields. Used by
   * both onSelect (existing evaluator) and onSave (newly created evaluator). Fields are
   * pre-computed by the API including type and optional flag.
   */
  const addEvaluatorToWorkbench = useCallback(
    (evaluator: EvaluatorWithFields): string | null => {
      // Already on the workbench: reuse it rather than silently doing nothing.
      const existingEvaluator = evaluators.find((e) => e.dbEvaluatorId === evaluator.id);
      if (existingEvaluator) return existingEvaluator.id;
      const evaluatorConfig = workbenchEvaluatorConfig(evaluator);

      // Add the evaluator globally (applies to all targets automatically).
      // The store runs auto-inference on add, so any auto-mappable fields are
      // already mapped by the time we read it back below.
      addEvaluator(evaluatorConfig);
      return evaluatorConfig.id;
    },
    [evaluators, addEvaluator],
  );

  /**
   * After adding an evaluator, decide whether to close the picker or guide the user to
   * its mapping drawer.
   */
  const guideOrCloseAfterAdd = useCallback(
    (addedId: string | null, isCodeEvaluator: boolean) => {
      // Read fresh state: the just-added config (with inferred mappings) is not
      // yet reflected in this closure's `evaluators`.
      const state = useEvaluationsV3Store.getState();
      const added = state.evaluators.find((e) => e.id === addedId);
      // The first target provides the mapping context for the drawer.
      const firstTarget = state.targets[0];

      if (!addedId || !added) {
        closeDrawer();
        return;
      }

      if (
        firstTarget &&
        evaluatorHasMissingMappings(added, state.activeDatasetId, firstTarget.id)
      ) {
        openEvaluatorEditor({
          evaluator: added,
          target: firstTarget,
          targetName:
            resolveTargetNameFromCache({
              target: firstTarget,
              utils: trpcUtils,
              projectId: project?.id,
            }) ?? "",
          isCodeEvaluator,
        });
        return;
      }
      closeDrawer();
    },
    [openEvaluatorEditor, closeDrawer, trpcUtils, project?.id],
  );

  // Handler for opening the evaluator selector (evaluators apply to ALL targets)
  const handleAddEvaluator = useCallback(() => {
    // Set up flow callback to handle evaluator selection (existing evaluator)
    // Note: EvaluatorListDrawer does NOT navigate after onSelect - caller must handle it
    setFlowCallbacks("evaluatorList", {
      onSelect: (evaluator: Parameters<typeof addEvaluatorToWorkbench>[0] & { type?: string }) => {
        const addedId = addEvaluatorToWorkbench(evaluator);
        guideOrCloseAfterAdd(addedId, evaluator.type === "code");
      },
    });

    // Set up flow callback to handle newly created evaluator
    // When user creates a new evaluator via the editor drawer, we need to:
    // 1. Fetch the newly created evaluator from DB
    // 2. Add it to the workbench
    // 3. Either close the drawer, or open its mapping drawer if fields are unmapped
    setFlowCallbacks(
      "evaluatorEditor",
      createEvaluatorEditorCallbacks({
        onSave: async (savedEvaluator: { id: string; name: string }) => {
          // Fetch the full evaluator data from DB
          const evaluator = await trpcUtils.evaluators.getById.fetch({
            id: savedEvaluator.id,
            projectId: project?.id ?? "",
          });

          if (evaluator) {
            const addedId = addEvaluatorToWorkbench(evaluator);
            guideOrCloseAfterAdd(addedId, evaluator.type === "code");
          } else {
            closeDrawer();
          }
          return true; // Indicate navigation was handled to prevent default back behavior
        },
      }),
    );

    openDrawer("evaluatorList");
  }, [
    openDrawer,
    closeDrawer,
    addEvaluatorToWorkbench,
    guideOrCloseAfterAdd,
    trpcUtils.evaluators.getById,
    project?.id,
  ]);

  return { handleAddEvaluator };
};

/** The add-target and switch-target flows, and their comparison context after a reload. */
export const useWorkbenchAddTargetFlow = ({
  pendingMappingsRef,
  pendingComparisonRef,
  switchingTargetIdRef,
  addOrReplaceTarget,
  handleSelectSavedAgent,
  handleSelectEvaluatorAsTarget,
  handleSelectPrompt,
  handleComparisonEvaluatorSave,
  handlePendingComparisonChange,
}: ReturnType<typeof useWorkbenchTargetSelection>) => {
  const { openDrawer, currentDrawer } = useDrawer();
  const { experimentId, updateTarget, updateTargetComparison } = useEvaluationsV3Store(
    useShallow((state) => ({
      experimentId: state.experimentId,
      updateTarget: state.updateTarget,
      updateTargetComparison: state.updateTargetComparison,
    })),
  );
  const { buildAvailableSources, isDatasetSource } = useOpenTargetEditor();
  const drawerParams = useDrawerParams();
  const drawerParamsKey = JSON.stringify(drawerParams);
  // Handler for opening the add target flow (prompts/agents)
  // Memoized to prevent TargetSuperHeader re-renders
  const handleAddTarget = useCallback(() => {
    // Clear any pending mappings from previous flows
    pendingMappingsRef.current = {};
    // Note: don't clear switchingTargetIdRef - handleSwitchTarget sets it before calling this

    // Build available sources for variable mapping (for new prompts)
    const availableSources = buildAvailableSources();

    // Handler to open promptEditor for new prompts with proper props
    const openNewPromptEditor = () => {
      openDrawer(
        "promptEditor",
        {
          // Pass available sources via complexProps
          availableSources,
          inputMappings: {},
          onInputMappingsChange: recordPendingMapping(pendingMappingsRef),
        },
        // Reset stack to prevent back button when creating new prompts
        { resetStack: true },
      );
    };

    // Set flow callbacks for the entire add-target flow
    setFlowCallbacks("promptList", {
      onSelect: handleSelectPrompt,
      // Custom onCreateNew to open promptEditor with availableSources
      onCreateNew: openNewPromptEditor,
    });
    setFlowCallbacks("promptEditor", {
      // New prompts collect their mappings here, applied when the prompt is saved.
      onInputMappingsChange: recordPendingMapping(pendingMappingsRef),
      onSave: (savedPrompt: SavedPrompt) => {
        addOrReplaceTarget(
          savedPromptTargetConfig({
            savedPrompt,
            pendingMappings: pendingMappingsRef.current,
            isDatasetSource,
            activeDatasetId: useEvaluationsV3Store.getState().activeDatasetId,
          }),
        );
        pendingMappingsRef.current = {};
      },
    });
    setFlowCallbacks("agentList", {
      onSelect: handleSelectSavedAgent,
    });
    setFlowCallbacks("agentCodeEditor", {
      onSave: handleSelectSavedAgent,
    });
    setFlowCallbacks("agentHttpEditor", {
      onSave: handleSelectSavedAgent,
    });
    setFlowCallbacks("workflowSelector", {
      onSave: handleSelectSavedAgent,
    });
    setFlowCallbacks("evaluatorList", {
      onSelect: handleSelectEvaluatorAsTarget,
    });
    // Build comparisonContext so the Comparison flow can pass it to evaluatorEditor —
    // this makes the creation form show the variant picker and Golden field
    // immediately, matching the edit-mode experience (#5195).
    pendingComparisonRef.current = null;
    const comparisonContext = comparisonContextOf(useEvaluationsV3Store.getState());

    // Set up flow callback for when a NEW evaluator is created during the target flow
    // This handles: add comparison > evaluator > create new > category > fill form > create
    // Same callbacks the reload re-hydration effect below registers — extracted
    // to stable useCallbacks so both paths wire identical behavior.
    setFlowCallbacks(
      "evaluatorEditor",
      createEvaluatorEditorCallbacks({
        onSave: handleComparisonEvaluatorSave,
        onComparisonChange: handlePendingComparisonChange,
      }),
    );
    openDrawer("targetTypeSelector", { comparisonContext });
  }, [
    buildAvailableSources,
    openDrawer,
    handleSelectPrompt,
    handleSelectSavedAgent,
    handleSelectEvaluatorAsTarget,
    isDatasetSource,
    handleComparisonEvaluatorSave,
    handlePendingComparisonChange,
    addOrReplaceTarget,
    pendingMappingsRef,
    pendingComparisonRef,
  ]);

  // Re-hydrate the comparison editor's flow context after a full page reload.
  useEffect(() => {
    if (currentDrawer !== "evaluatorEditor") return;
    const evaluatorType = drawerParams.evaluatorType;
    const isComparisonType =
      evaluatorType === COMPARISON_EVALUATOR_TYPE ||
      evaluatorType === LEGACY_PAIRWISE_EVALUATOR_TYPE;
    if (!isComparisonType) return;
    // Wait for the workbench store to finish hydrating (loadState sets
    // experimentId atomically with targets/datasets); reading getState() before
    // then would snapshot an empty picker and lock it in (the guard below blocks
    // a later refresh).
    if (!experimentId) return;
    // Flow context already present → a live Add/edit flow (or an earlier run of
    // this effect) wired it up. Also the loop guard.
    const alreadyWired = (
      getFlowCallbacks("evaluatorEditor") as { onComparisonChange?: unknown } | undefined
    )?.onComparisonChange;
    if (alreadyWired) return;

    const { targetMatch, comparisonContext } = reloadedComparisonContext({
      state: useEvaluationsV3Store.getState(),
      evaluatorId: drawerParams.evaluatorId,
    });

    // targetMatch means this reload resumed editing an EXISTING comparison column, not
    // the New Comparison add flow.
    setFlowCallbacks(
      "evaluatorEditor",
      targetMatch
        ? createEvaluatorEditorCallbacks({
            targetId: targetMatch.id,
            updateTarget,
            onComparisonChange: (next) => {
              updateTargetComparison(targetMatch.id, next);
            },
          })
        : createEvaluatorEditorCallbacks({
            onSave: handleComparisonEvaluatorSave,
            onComparisonChange: handlePendingComparisonChange,
          }),
    );
    setComplexProps({ comparisonContext });
    // drawerParams read through the stable drawerParamsKey signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentDrawer,
    drawerParamsKey,
    experimentId,
    handleComparisonEvaluatorSave,
    handlePendingComparisonChange,
    updateTarget,
    updateTargetComparison,
  ]);

  // Handler for switching a target (replace with another prompt/agent/evaluator)
  // Opens the specific drawer based on target type
  const handleSwitchTarget = useCallback(
    (target: TargetConfig) => {
      // Store the target ID being switched - will be removed when new target is added
      switchingTargetIdRef.current = target.id;

      // Set up flow callbacks (same as handleAddTarget but we open specific drawer)
      setFlowCallbacks("promptList", {
        onSelect: handleSelectPrompt,
      });
      setFlowCallbacks("agentList", {
        onSelect: handleSelectSavedAgent,
      });
      setFlowCallbacks("evaluatorList", {
        onSelect: handleSelectEvaluatorAsTarget,
      });

      // A workflow target has no picker to reopen.
      if (target.type !== "workflow") openDrawer(SWITCH_DRAWERS[target.type]);
    },
    [
      openDrawer,
      handleSelectPrompt,
      handleSelectSavedAgent,
      handleSelectEvaluatorAsTarget,
      switchingTargetIdRef,
    ],
  );

  return { handleAddTarget, handleSwitchTarget };
};
