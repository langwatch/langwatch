/**
 * Drawer Registry - Single source of truth for drawer components and their types.
 *
 * This file exports:
 * - `drawers`: Map of drawer names to their React components
 * - `DrawerType`: Union type of all drawer names
 * - `DrawerProps<T>`: Props type for a specific drawer
 * - `DrawerCallbacks<T>`: Callback props (functions) for a specific drawer
 *
 * All drawers are lazy-loaded to avoid pulling their transitive dependencies
 * (monaco-editor, shiki, react-admin, OTel SDK, etc.) into the initial bundle.
 * CurrentDrawer already wraps rendering in <Suspense>, so this just works.
 */
import { lazy, type ComponentProps } from "react";

const lazyDefault = <T extends Record<string, React.FC<any>>>(
  factory: () => Promise<T>,
  key: keyof T,
) => lazy(() => factory().then((m) => ({ default: m[key] })));

const AddAnnotationQueueDrawer = lazyDefault(
  () => import("./AddAnnotationQueueDrawer"),
  "AddAnnotationQueueDrawer",
);
const AddDatasetRecordDrawerV2 = lazyDefault(
  () => import("./AddDatasetRecordDrawer"),
  "AddDatasetRecordDrawerV2",
);
const AddOrEditAnnotationScoreDrawer = lazyDefault(
  () => import("./AddOrEditAnnotationScoreDrawer"),
  "AddOrEditAnnotationScoreDrawer",
);
const AddOrEditDatasetDrawer = lazyDefault(
  () => import("./AddOrEditDatasetDrawer"),
  "AddOrEditDatasetDrawer",
);
const AutomationDrawer = lazyDefault(
  () => import("./AddAutomationDrawer"),
  "AutomationDrawer",
);
const AgentCodeEditorDrawer = lazyDefault(
  () => import("./agents/AgentCodeEditorDrawer"),
  "AgentCodeEditorDrawer",
);
const AgentHistoryDrawer = lazyDefault(
  () => import("./agents/AgentHistoryDrawer"),
  "AgentHistoryDrawer",
);
const AgentHttpEditorDrawer = lazyDefault(
  () => import("./agents/AgentHttpEditorDrawer"),
  "AgentHttpEditorDrawer",
);
const AgentListDrawer = lazyDefault(
  () => import("./agents/AgentListDrawer"),
  "AgentListDrawer",
);
const AgentTypeSelectorDrawer = lazyDefault(
  () => import("./agents/AgentTypeSelectorDrawer"),
  "AgentTypeSelectorDrawer",
);
const AgentWorkflowEditorDrawer = lazyDefault(
  () => import("./agents/AgentWorkflowEditorDrawer"),
  "AgentWorkflowEditorDrawer",
);
const WorkflowSelectorDrawer = lazyDefault(
  () => import("./agents/WorkflowSelectorDrawer"),
  "WorkflowSelectorDrawer",
);
const AlertDrawer = lazyDefault(
  () => import("./analytics/AlertDrawer"),
  "AlertDrawer",
);
const DashboardNameDrawer = lazyDefault(
  () => import("./analytics/DashboardNameDrawer"),
  "DashboardNameDrawer",
);
const BatchEvaluationDrawer = lazyDefault(
  () => import("./BatchEvaluationDrawer"),
  "BatchEvaluationDrawer",
);
const SelectDatasetDrawer = lazyDefault(
  () => import("./datasets/SelectDatasetDrawer"),
  "SelectDatasetDrawer",
);
const UploadCSVModal = lazyDefault(
  () => import("./datasets/UploadCSVModal"),
  "UploadCSVModal",
);
const EditModelProviderDrawer = lazyDefault(
  () => import("./EditModelProviderDrawer"),
  "EditModelProviderDrawer",
);
const EditAutomationFilterDrawer = lazyDefault(
  () => import("./EditAutomationFilterDrawer"),
  "EditAutomationFilterDrawer",
);
const GuardrailsDrawer = lazyDefault(
  () => import("./evaluations/GuardrailsDrawer"),
  "GuardrailsDrawer",
);
const OnlineEvaluationDrawer = lazyDefault(
  () => import("./evaluations/OnlineEvaluationDrawer"),
  "OnlineEvaluationDrawer",
);
const EvaluatorCategorySelectorDrawer = lazyDefault(
  () => import("./evaluators/EvaluatorCategorySelectorDrawer"),
  "EvaluatorCategorySelectorDrawer",
);
const EvaluatorEditorDrawer = lazyDefault(
  () => import("./evaluators/EvaluatorEditorDrawer"),
  "EvaluatorEditorDrawer",
);
const EvaluatorHistoryDrawer = lazyDefault(
  () => import("./evaluators/EvaluatorHistoryDrawer"),
  "EvaluatorHistoryDrawer",
);
const EvaluatorListDrawer = lazyDefault(
  () => import("./evaluators/EvaluatorListDrawer"),
  "EvaluatorListDrawer",
);
const EvaluatorTypeSelectorDrawer = lazyDefault(
  () => import("./evaluators/EvaluatorTypeSelectorDrawer"),
  "EvaluatorTypeSelectorDrawer",
);
const WorkflowSelectorForEvaluatorDrawer = lazyDefault(
  () => import("./evaluators/WorkflowSelectorForEvaluatorDrawer"),
  "WorkflowSelectorForEvaluatorDrawer",
);
const SdkRadarDrawer = lazyDefault(
  () => import("./drawers/SdkRadarDrawer"),
  "SdkRadarDrawer",
);
const FoundryDrawer = lazy(
  () => import("./ops/foundry/FoundryDrawer").then((m) => ({ default: m.FoundryDrawer })),
);
const CreateProjectDrawer = lazyDefault(
  () => import("./projects/CreateProjectDrawer"),
  "CreateProjectDrawer",
);
const PromptEditorDrawer = lazyDefault(
  () => import("./prompts/PromptEditorDrawer"),
  "PromptEditorDrawer",
);
const PromptListDrawer = lazyDefault(
  () => import("./prompts/PromptListDrawer"),
  "PromptListDrawer",
);
const SeriesFiltersDrawer = lazyDefault(
  () => import("./SeriesFilterDrawer"),
  "SeriesFiltersDrawer",
);
const ScenarioFormDrawerFromUrl = lazyDefault(
  () => import("./scenarios/ScenarioFormDrawer"),
  "ScenarioFormDrawerFromUrl",
);
const CreateTeamDrawer = lazyDefault(
  () => import("./settings/CreateTeamDrawer"),
  "CreateTeamDrawer",
);
const LLMModelCostDrawer = lazyDefault(
  () => import("./settings/LLMModelCostDrawer"),
  "LLMModelCostDrawer",
);
const ScenarioRunDetailDrawer = lazyDefault(
  () => import("./simulations/ScenarioRunDetailDrawer"),
  "ScenarioRunDetailDrawer",
);
const SuiteFormDrawer = lazyDefault(
  () => import("./suites/SuiteFormDrawer"),
  "SuiteFormDrawer",
);
const TraceDetailsDrawer = lazyDefault(
  () => import("./TraceDetailsDrawer"),
  "TraceDetailsDrawer",
);
const TargetTypeSelectorDrawer = lazyDefault(
  () => import("./targets/TargetTypeSelectorDrawer"),
  "TargetTypeSelectorDrawer",
);

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
  agentHistory: AgentHistoryDrawer,
  agentTypeSelector: AgentTypeSelectorDrawer,
  agentCodeEditor: AgentCodeEditorDrawer,
  agentHttpEditor: AgentHttpEditorDrawer,
  agentWorkflowEditor: AgentWorkflowEditorDrawer,
  workflowSelector: WorkflowSelectorDrawer,
  evaluatorHistory: EvaluatorHistoryDrawer,
  evaluatorList: EvaluatorListDrawer,
  evaluatorCategorySelector: EvaluatorCategorySelectorDrawer,
  evaluatorTypeSelector: EvaluatorTypeSelectorDrawer,
  evaluatorEditor: EvaluatorEditorDrawer,
  // Workflow selector specifically for evaluators (creates evaluator, not agent)
  workflowSelectorForEvaluator: WorkflowSelectorForEvaluatorDrawer,
  // Scenarios
  scenarioEditor: ScenarioFormDrawerFromUrl,
  scenarioRunDetail: ScenarioRunDetailDrawer,
  // Suites
  suiteEditor: SuiteFormDrawer,
  // Project management
  createProject: CreateProjectDrawer,
  createTeam: CreateTeamDrawer,
  // Online Evaluations (Monitors)
  onlineEvaluation: OnlineEvaluationDrawer,
  guardrails: GuardrailsDrawer,
  // SDK Radar
  sdkRadar: SdkRadarDrawer,
  // Ops
  foundry: FoundryDrawer,
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
