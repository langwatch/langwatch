/**
 * Drawer Registry - Single source of truth for drawer components and their types.
 *
 * This file exports:
 * - `drawers`: Map of drawer names to their React components
 * - `DrawerType`: Union type of all drawer names
 * - `DrawerProps<T>`: Props type for a specific drawer
 * - `DrawerCallbacks<T>`: Callback props (functions) for a specific drawer
 */
import type { ComponentProps } from "react";

import { AddAnnotationQueueDrawer } from "./AddAnnotationQueueDrawer";
import { AddDatasetRecordDrawerV2 } from "./AddDatasetRecordDrawer";
import { AddOrEditModelProviderDrawer } from "./AddOrEditModelProviderDrawer";
import { AddOrEditAnnotationScoreDrawer } from "./AddOrEditAnnotationScoreDrawer";
import { AddOrEditDatasetDrawer } from "./AddOrEditDatasetDrawer";
import { TriggerDrawer } from "./AddTriggerDrawer";
import { BatchEvaluationDrawer } from "./BatchEvaluationDrawer";
import { SelectDatasetDrawer } from "./datasets/SelectDatasetDrawer";
import { UploadCSVModal } from "./datasets/UploadCSVModal";
import { EditTriggerFilterDrawer } from "./EditTriggerFilterDrawer";
import { SeriesFiltersDrawer } from "./SeriesFilterDrawer";
import { LLMModelCostDrawer } from "./settings/LLMModelCostDrawer";
import { TraceDetailsDrawer } from "./TraceDetailsDrawer";
import { AlertDrawer } from "./analytics/AlertDrawer";
// Evaluations V3 drawers
import { TargetTypeSelectorDrawer } from "./targets/TargetTypeSelectorDrawer";
import { PromptListDrawer } from "./prompts/PromptListDrawer";
import { PromptEditorDrawer } from "./prompts/PromptEditorDrawer";
import { AgentListDrawer } from "./agents/AgentListDrawer";
import { AgentTypeSelectorDrawer } from "./agents/AgentTypeSelectorDrawer";
import { AgentCodeEditorDrawer } from "./agents/AgentCodeEditorDrawer";
import { WorkflowSelectorDrawer } from "./agents/WorkflowSelectorDrawer";
import { EvaluatorListDrawer } from "./evaluators/EvaluatorListDrawer";
import { EvaluatorCategorySelectorDrawer } from "./evaluators/EvaluatorCategorySelectorDrawer";
import { EvaluatorTypeSelectorDrawer } from "./evaluators/EvaluatorTypeSelectorDrawer";
import { EvaluatorEditorDrawer } from "./evaluators/EvaluatorEditorDrawer";
import { ScenarioFormDrawer } from "./scenarios/ScenarioFormDrawer";

/**
 * Map of drawer names to their React components.
 * Add new drawers here - types will be automatically derived.
 */
export const drawers = {
  traceDetails: TraceDetailsDrawer,
  batchEvaluation: BatchEvaluationDrawer,
  trigger: TriggerDrawer,
  addOrEditModelProvier : AddOrEditModelProviderDrawer,
  addOrEditAnnotationScore: AddOrEditAnnotationScoreDrawer,
  addAnnotationQueue: AddAnnotationQueueDrawer,
  addDatasetRecord: AddDatasetRecordDrawerV2,
  llmModelCost: LLMModelCostDrawer,
  uploadCSV: UploadCSVModal,
  addOrEditDataset: AddOrEditDatasetDrawer,
  editTriggerFilter: EditTriggerFilterDrawer,
  seriesFilters: SeriesFiltersDrawer,
  selectDataset: SelectDatasetDrawer,
  customGraphAlert: AlertDrawer,
  // Evaluations V3 drawers
  targetTypeSelector: TargetTypeSelectorDrawer,
  promptList: PromptListDrawer,
  promptEditor: PromptEditorDrawer,
  agentList: AgentListDrawer,
  agentTypeSelector: AgentTypeSelectorDrawer,
  agentCodeEditor: AgentCodeEditorDrawer,
  workflowSelector: WorkflowSelectorDrawer,
  evaluatorList: EvaluatorListDrawer,
  evaluatorCategorySelector: EvaluatorCategorySelectorDrawer,
  evaluatorTypeSelector: EvaluatorTypeSelectorDrawer,
  evaluatorEditor: EvaluatorEditorDrawer,
  // Workflow selector specifically for evaluators (same component, different context)
  workflowSelectorForEvaluator: WorkflowSelectorDrawer,
  // Scenarios
  scenarioEditor: ScenarioFormDrawer,
} satisfies Record<string, React.FC<any>>;

/**
 * Union type of all registered drawer names.
 */
export type DrawerType = keyof typeof drawers;

/**
 * Get the props type for a specific drawer.
 */
export type DrawerProps<T extends DrawerType> = ComponentProps<
  (typeof drawers)[T]
>;

/**
 * Extract only the callback (function) props from a drawer's props.
 * Used for type-safe flow callback registration.
 */
export type DrawerCallbacks<T extends DrawerType> = {
  [K in keyof DrawerProps<T> as DrawerProps<T>[K] extends
    | ((...args: any[]) => any)
    | undefined
    ? K
    : never]?: DrawerProps<T>[K];
};

/**
 * Type for the flow callbacks registry.
 * Maps drawer types to their callback props.
 */
export type FlowCallbacksRegistry = {
  [T in DrawerType]?: DrawerCallbacks<T>;
};
