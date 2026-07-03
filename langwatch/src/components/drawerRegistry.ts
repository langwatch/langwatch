/**
 * Drawer Registry - Single source of truth for drawer components and their types.
 *
 * This file exports:
 * - `drawers`: Map of drawer names to their React components
 * - `DrawerType`: Union type of all drawer names
 * - `DrawerProps<T>`: Props type for a specific drawer
 * - `DrawerCallbacks<T>`: Callback props (functions) for a specific drawer
 *
 * All drawers are lazy-loaded so their transitive dependencies (monaco-editor,
 * shiki, react-admin, OTel SDK, etc.) stay out of the initial bundle.
 * `CurrentDrawer` already wraps rendering in <Suspense>, so this just works.
 */
import { type ComponentProps, type FC, lazy } from "react";

import type { TraceV2DrawerShellProps } from "../features/traces-v2/components/TraceDrawer";

const lazyDefault = <K extends string, T extends { [P in K]: React.FC<any> }>({
  factory,
  key,
}: {
  factory: () => Promise<T>;
  key: K;
}) => {
  const Component = lazy(() => factory().then((m) => ({ default: m[key] })));
  // Preserve the original export's name on the lazy wrapper so React DevTools
  // and regression tests (e.g. scenariosIndexNoDoubleDrawer) can still
  // identify the underlying drawer.
  Object.defineProperty(Component, "name", { value: key });
  return Component;
};

const AddAnnotationQueueDrawer = lazyDefault({
  factory: () => import("./AddAnnotationQueueDrawer"),
  key: "AddAnnotationQueueDrawer",
});
const AddDatasetRecordDrawerV2 = lazyDefault({
  factory: () => import("./AddDatasetRecordDrawer"),
  key: "AddDatasetRecordDrawerV2",
});
const AddOrEditAnnotationScoreDrawer = lazyDefault({
  factory: () => import("./AddOrEditAnnotationScoreDrawer"),
  key: "AddOrEditAnnotationScoreDrawer",
});
const AddOrEditDatasetDrawer = lazyDefault({
  factory: () => import("./AddOrEditDatasetDrawer"),
  key: "AddOrEditDatasetDrawer",
});
const AutomationDrawer = lazyDefault({
  factory: () => import("~/features/automations/AutomationDrawer"),
  key: "AutomationDrawer",
});
const AgentHistoryDrawer = lazyDefault({
  factory: () => import("./agents/AgentHistoryDrawer"),
  key: "AgentHistoryDrawer",
});
const AgentListDrawer = lazyDefault({
  factory: () => import("./agents/AgentListDrawer"),
  key: "AgentListDrawer",
});
const AgentTypeSelectorDrawer = lazyDefault({
  factory: () => import("./agents/AgentTypeSelectorDrawer"),
  key: "AgentTypeSelectorDrawer",
});
const AgentWorkflowEditorDrawer = lazyDefault({
  factory: () => import("./agents/AgentWorkflowEditorDrawer"),
  key: "AgentWorkflowEditorDrawer",
});
const AgentCodeEditorDrawerFromUrl = lazyDefault({
  factory: () => import("./agents/drawerFromUrl"),
  key: "AgentCodeEditorDrawerFromUrl",
});
const AgentHttpEditorDrawerFromUrl = lazyDefault({
  factory: () => import("./agents/drawerFromUrl"),
  key: "AgentHttpEditorDrawerFromUrl",
});
const WorkflowSelectorDrawerFromUrl = lazyDefault({
  factory: () => import("./agents/drawerFromUrl"),
  key: "WorkflowSelectorDrawerFromUrl",
});
const DashboardNameDrawer = lazyDefault({
  factory: () => import("./analytics/DashboardNameDrawer"),
  key: "DashboardNameDrawer",
});
const SelectDatasetDrawer = lazyDefault({
  factory: () => import("./datasets/SelectDatasetDrawer"),
  key: "SelectDatasetDrawer",
});
const UploadCSVDrawer = lazyDefault({
  factory: () => import("./datasets/UploadCSVDrawer"),
  key: "UploadCSVDrawer",
});
const FeatureFlagsDrawer = lazyDefault({
  factory: () => import("./drawers/FeatureFlagsDrawer"),
  key: "FeatureFlagsDrawer",
});
const SdkRadarDrawer = lazyDefault({
  factory: () => import("./drawers/SdkRadarDrawer"),
  key: "SdkRadarDrawer",
});
const EditAutomationFilterDrawer = lazyDefault({
  factory: () => import("./EditAutomationFilterDrawer"),
  key: "EditAutomationFilterDrawer",
});
const EditModelProviderDrawer = lazyDefault({
  factory: () => import("./EditModelProviderDrawer"),
  key: "EditModelProviderDrawer",
});
const GuardrailsDrawer = lazyDefault({
  factory: () => import("./evaluations/GuardrailsDrawer"),
  key: "GuardrailsDrawer",
});
const OnlineEvaluationDrawer = lazyDefault({
  factory: () => import("./evaluations/OnlineEvaluationDrawer"),
  key: "OnlineEvaluationDrawer",
});
const CodeEvaluatorEditorDrawer = lazyDefault({
  factory: () => import("./evaluators/CodeEvaluatorEditorDrawer"),
  key: "CodeEvaluatorEditorDrawer",
});
const EvaluatorCategorySelectorDrawer = lazyDefault({
  factory: () => import("./evaluators/EvaluatorCategorySelectorDrawer"),
  key: "EvaluatorCategorySelectorDrawer",
});
const EvaluatorEditorDrawer = lazyDefault({
  factory: () => import("./evaluators/EvaluatorEditorDrawer"),
  key: "EvaluatorEditorDrawer",
});
const EvaluatorHistoryDrawer = lazyDefault({
  factory: () => import("./evaluators/EvaluatorHistoryDrawer"),
  key: "EvaluatorHistoryDrawer",
});
const EvaluatorListDrawer = lazyDefault({
  factory: () => import("./evaluators/EvaluatorListDrawer"),
  key: "EvaluatorListDrawer",
});
const EvaluatorTypeSelectorDrawer = lazyDefault({
  factory: () => import("./evaluators/EvaluatorTypeSelectorDrawer"),
  key: "EvaluatorTypeSelectorDrawer",
});
const WorkflowSelectorForEvaluatorDrawer = lazyDefault({
  factory: () => import("./evaluators/WorkflowSelectorForEvaluatorDrawer"),
  key: "WorkflowSelectorForEvaluatorDrawer",
});
const FoundryDrawer = lazyDefault({
  factory: () => import("./ops/foundry/FoundryDrawer"),
  key: "FoundryDrawer",
});
const CreateProjectDrawer = lazyDefault({
  factory: () => import("./projects/CreateProjectDrawer"),
  key: "CreateProjectDrawer",
});
const EditProjectDrawer = lazyDefault({
  factory: () => import("./projects/EditProjectDrawer"),
  key: "EditProjectDrawer",
});
const PromptEditorDrawer = lazyDefault({
  factory: () => import("./prompts/PromptEditorDrawer"),
  key: "PromptEditorDrawer",
});
const PromptListDrawer = lazyDefault({
  factory: () => import("./prompts/PromptListDrawer"),
  key: "PromptListDrawer",
});
const ScenarioFormDrawerFromUrl = lazyDefault({
  factory: () => import("./scenarios/ScenarioFormDrawer"),
  key: "ScenarioFormDrawerFromUrl",
});
const SeriesFiltersDrawer = lazyDefault({
  factory: () => import("./SeriesFilterDrawer"),
  key: "SeriesFiltersDrawer",
});
const CreateTeamDrawer = lazyDefault({
  factory: () => import("./settings/CreateTeamDrawer"),
  key: "CreateTeamDrawer",
});
const DataPrivacyRuleDrawer = lazyDefault({
  factory: () => import("./settings/DataPrivacyRuleDrawer"),
  key: "DataPrivacyRuleDrawer",
});
const DefaultModelOverrideDrawer = lazyDefault({
  factory: () => import("./settings/DefaultModelOverrideDrawer"),
  key: "DefaultModelOverrideDrawer",
});
const LLMModelCostDrawer = lazyDefault({
  factory: () => import("./settings/LLMModelCostDrawer"),
  key: "LLMModelCostDrawer",
});
const ScenarioRunDetailDrawer = lazyDefault({
  factory: () => import("./simulations/ScenarioRunDetailDrawer"),
  key: "ScenarioRunDetailDrawer",
});
const SuiteFormDrawer = lazyDefault({
  factory: () => import("./suites/SuiteFormDrawer"),
  key: "SuiteFormDrawer",
});
const TargetTypeSelectorDrawer = lazyDefault({
  factory: () => import("./targets/TargetTypeSelectorDrawer"),
  key: "TargetTypeSelectorDrawer",
});
const TraceDetailsDrawer = lazyDefault({
  factory: () => import("./TraceDetailsDrawer"),
  key: "TraceDetailsDrawer",
});

// Traces V2 drawers — the real shell is mounted from `TracesPage` based
// on the drawer store (so a click → drawer-open is synchronous, no
// round-trip through the URL). The registry entry stays as a noop so
// the `DrawerType` union still contains `"traceV2Details"` and every
// `openDrawer("traceV2Details", …)` call still typechecks; CurrentDrawer
// rendering it would just double-mount on top of the page-level mount.
// The prop shape mirrors `TraceV2DrawerShellProps` exactly so
// `openDrawer("traceV2Details", { traceId, t, ... })` still typechecks
// at every call site.
const TraceV2DrawerNoop: FC<TraceV2DrawerShellProps> = () => null;

/**
 * Map of drawer names to their React components.
 * Add new drawers here - types will be automatically derived.
 */
export const drawers = {
  traceDetails: TraceDetailsDrawer,
  traceV2Details: TraceV2DrawerNoop,
  automation: AutomationDrawer,
  editModelProvider: EditModelProviderDrawer,
  defaultModelOverride: DefaultModelOverrideDrawer,
  addOrEditAnnotationScore: AddOrEditAnnotationScoreDrawer,
  addAnnotationQueue: AddAnnotationQueueDrawer,
  addDatasetRecord: AddDatasetRecordDrawerV2,
  llmModelCost: LLMModelCostDrawer,
  uploadCSV: UploadCSVDrawer,
  addOrEditDataset: AddOrEditDatasetDrawer,
  editAutomationFilter: EditAutomationFilterDrawer,
  seriesFilters: SeriesFiltersDrawer,
  selectDataset: SelectDatasetDrawer,
  dashboardName: DashboardNameDrawer,
  // Evaluations V3 drawers
  targetTypeSelector: TargetTypeSelectorDrawer,
  promptList: PromptListDrawer,
  promptEditor: PromptEditorDrawer,
  agentList: AgentListDrawer,
  agentHistory: AgentHistoryDrawer,
  agentTypeSelector: AgentTypeSelectorDrawer,
  agentCodeEditor: AgentCodeEditorDrawerFromUrl,
  agentHttpEditor: AgentHttpEditorDrawerFromUrl,
  agentWorkflowEditor: AgentWorkflowEditorDrawer,
  workflowSelector: WorkflowSelectorDrawerFromUrl,
  evaluatorHistory: EvaluatorHistoryDrawer,
  evaluatorList: EvaluatorListDrawer,
  evaluatorCategorySelector: EvaluatorCategorySelectorDrawer,
  evaluatorTypeSelector: EvaluatorTypeSelectorDrawer,
  evaluatorEditor: EvaluatorEditorDrawer,
  codeEvaluatorEditor: CodeEvaluatorEditorDrawer,
  // Workflow selector specifically for evaluators (creates evaluator, not agent)
  workflowSelectorForEvaluator: WorkflowSelectorForEvaluatorDrawer,
  // Scenarios
  scenarioEditor: ScenarioFormDrawerFromUrl,
  scenarioRunDetail: ScenarioRunDetailDrawer,
  // Suites
  suiteEditor: SuiteFormDrawer,
  // Data privacy
  dataPrivacyRule: DataPrivacyRuleDrawer,
  // Project management
  createProject: CreateProjectDrawer,
  editProject: EditProjectDrawer,
  createTeam: CreateTeamDrawer,
  // Online Evaluations (Monitors)
  onlineEvaluation: OnlineEvaluationDrawer,
  guardrails: GuardrailsDrawer,
  // SDK Radar
  sdkRadar: SdkRadarDrawer,
  // Dev tools
  featureFlags: FeatureFlagsDrawer,
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
