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
import { AddOrEditAnnotationScoreDrawer } from "./AddOrEditAnnotationScoreDrawer";
import { AddOrEditDatasetDrawer } from "./AddOrEditDatasetDrawer";
import { AutomationDrawer } from "./AddAutomationDrawer";
import { AgentCodeEditorDrawer } from "./agents/AgentCodeEditorDrawer";
import { AgentHttpEditorDrawer } from "./agents/AgentHttpEditorDrawer";
import { AgentListDrawer } from "./agents/AgentListDrawer";
import { AgentTypeSelectorDrawer } from "./agents/AgentTypeSelectorDrawer";
import { WorkflowSelectorDrawer } from "./agents/WorkflowSelectorDrawer";
import { AlertDrawer } from "./analytics/AlertDrawer";
import { DashboardNameDrawer } from "./analytics/DashboardNameDrawer";
import { BatchEvaluationDrawer } from "./BatchEvaluationDrawer";
import { SelectDatasetDrawer } from "./datasets/SelectDatasetDrawer";
import { UploadCSVModal } from "./datasets/UploadCSVModal";
import { EditModelProviderDrawer } from "./EditModelProviderDrawer";
import { EditAutomationFilterDrawer } from "./EditAutomationFilterDrawer";
import { GuardrailsDrawer } from "./evaluations/GuardrailsDrawer";
// Online Evaluations (Monitors) drawers
import { OnlineEvaluationDrawer } from "./evaluations/OnlineEvaluationDrawer";
import { EvaluatorCategorySelectorDrawer } from "./evaluators/EvaluatorCategorySelectorDrawer";
import { EvaluatorEditorDrawer } from "./evaluators/EvaluatorEditorDrawer";
import { EvaluatorListDrawer } from "./evaluators/EvaluatorListDrawer";
import { EvaluatorTypeSelectorDrawer } from "./evaluators/EvaluatorTypeSelectorDrawer";
import { WorkflowSelectorForEvaluatorDrawer } from "./evaluators/WorkflowSelectorForEvaluatorDrawer";
import { SdkRadarDrawer } from "./drawers/SdkRadarDrawer";
import { CreateProjectDrawer } from "./projects/CreateProjectDrawer";
import { PromptEditorDrawer } from "./prompts/PromptEditorDrawer";
import { PromptListDrawer } from "./prompts/PromptListDrawer";
import { SeriesFiltersDrawer } from "./SeriesFilterDrawer";
import { ScenarioFormDrawer } from "./scenarios/ScenarioFormDrawer";
import { LLMModelCostDrawer } from "./settings/LLMModelCostDrawer";
import { SuiteFormDrawer } from "./suites/SuiteFormDrawer";
import { TraceDetailsDrawer } from "./TraceDetailsDrawer";
// Evaluations V3 drawers
import { TargetTypeSelectorDrawer } from "./targets/TargetTypeSelectorDrawer";

/**
 * Map of drawer names to their React components.
 * Add new drawers here - types will be automatically derived.
 */
export const drawers = {
  traceDetails: TraceDetailsDrawer,
  batchEvaluation: BatchEvaluationDrawer,
  automation: AutomationDrawer,
  editModelProvider: EditModelProviderDrawer,
  addOrEditAnnotationScore: AddOrEditAnnotationScoreDrawer,
  addAnnotationQueue: AddAnnotationQueueDrawer,
  addDatasetRecord: AddDatasetRecordDrawerV2,
  llmModelCost: LLMModelCostDrawer,
  uploadCSV: UploadCSVModal,
  addOrEditDataset: AddOrEditDatasetDrawer,
  editAutomationFilter: EditAutomationFilterDrawer,
  seriesFilters: SeriesFiltersDrawer,
  selectDataset: SelectDatasetDrawer,
  customGraphAlert: AlertDrawer,
  dashboardName: DashboardNameDrawer,
  // Evaluations V3 drawers
  targetTypeSelector: TargetTypeSelectorDrawer,
  promptList: PromptListDrawer,
  promptEditor: PromptEditorDrawer,
  agentList: AgentListDrawer,
  agentTypeSelector: AgentTypeSelectorDrawer,
  agentCodeEditor: AgentCodeEditorDrawer,
  agentHttpEditor: AgentHttpEditorDrawer,
  workflowSelector: WorkflowSelectorDrawer,
  evaluatorList: EvaluatorListDrawer,
  evaluatorCategorySelector: EvaluatorCategorySelectorDrawer,
  evaluatorTypeSelector: EvaluatorTypeSelectorDrawer,
  evaluatorEditor: EvaluatorEditorDrawer,
  // Workflow selector specifically for evaluators (creates evaluator, not agent)
  workflowSelectorForEvaluator: WorkflowSelectorForEvaluatorDrawer,
  // Scenarios
  scenarioEditor: ScenarioFormDrawer,
  // Suites
  suiteEditor: SuiteFormDrawer,
  // Project management
  createProject: CreateProjectDrawer,
  // Online Evaluations (Monitors)
  onlineEvaluation: OnlineEvaluationDrawer,
  guardrails: GuardrailsDrawer,
  // SDK Radar
  sdkRadar: SdkRadarDrawer,
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
