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

import { warmChunk } from "@langwatch/ui";
import type { TraceV2DrawerShellProps } from "../features/traces-v2/components/TraceDrawer";

/** The import behind each lazy drawer, so a screen can fetch it early. */
const chunkFactories = new WeakMap<object, () => Promise<unknown>>();

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
  chunkFactories.set(Component, factory);
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
const ViewAutomationDrawer = lazyDefault({
  factory: () => import("~/features/automations/ViewAutomationDrawer"),
  key: "ViewAutomationDrawer",
});
const AgentHistoryDrawer = lazyDefault({
  factory: () => import("~/runtime/ui/features/agent-ui-host.adapter"),
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
const AgentWorkflowTargetEditorDrawer = lazyDefault({
  factory: () => import("./agents/AgentWorkflowTargetEditorDrawer"),
  key: "AgentWorkflowTargetEditorDrawer",
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
const GroupDetailDrawer = lazyDefault({
  factory: () => import("./ops/queues/groupDetail/GroupDetailDrawer"),
  key: "GroupDetailDrawer",
});
const ProcessInstanceDrawer = lazyDefault({
  factory: () => import("./ops/processes/instanceDrawer/ProcessInstanceDrawer"),
  key: "ProcessInstanceDrawer",
});
const ProcessInstancesDrawer = lazyDefault({
  factory: () => import("./ops/processes/ProcessInstancesDrawer"),
  key: "ProcessInstancesDrawer",
});
const OpsBlobsDrawer = lazyDefault({
  factory: () => import("./ops/blobs/OpsBlobsDrawer"),
  key: "OpsBlobsDrawer",
});
const OpsReplayDrawer = lazyDefault({
  factory: () => import("./ops/projections/OpsReplayDrawer"),
  key: "OpsReplayDrawer",
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
const ComparisonLeaderboardDrawer = lazyDefault({
  factory: () => import("./ComparisonLeaderboardDrawer"),
  key: "ComparisonLeaderboardDrawer",
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
  factory: () => import("~/features/ops/foundry-drawer.transport"),
  key: "FoundryDrawer",
});
const PullRequestDetailDrawer = lazyDefault({
  factory: () => import("./me/PullRequestDetailDrawer"),
  key: "PullRequestDetailDrawer",
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
const InviteMemberDrawer = lazyDefault({
  factory: () => import("./settings/InviteMemberDrawer"),
  key: "InviteMemberDrawer",
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
const ScenarioVersionHistoryDrawer = lazyDefault({
  factory: () => import("./agent-testing/drawers/ScenarioVersionHistoryDrawer"),
  key: "ScenarioVersionHistoryDrawer",
});
const SuiteFormDrawer = lazyDefault({
  factory: () => import("./suites/SuiteFormDrawer"),
  key: "SuiteFormDrawer",
});
const AgentTestingPlanModal = lazyDefault({
  factory: () => import("./agent-testing/plan/PlanModal"),
  key: "PlanModal",
});
const TargetTypeSelectorDrawer = lazyDefault({
  factory: () => import("./targets/TargetTypeSelectorDrawer"),
  key: "TargetTypeSelectorDrawer",
});
const LegacyTraceDrawerRedirect = lazyDefault({
  factory: () => import("./LegacyTraceDrawerRedirect"),
  key: "LegacyTraceDrawerRedirect",
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
  // The legacy trace drawer is gone. The name is kept because it is resolved
  // straight from the address bar, so links shared before the removal — and
  // the REST/notification URLs that named it — would otherwise resolve to
  // nothing. It redirects to `traceV2Details` on the page it was opened on.
  traceDetails: LegacyTraceDrawerRedirect,
  traceV2Details: TraceV2DrawerNoop,
  automation: AutomationDrawer,
  viewAutomation: ViewAutomationDrawer,
  editModelProvider: EditModelProviderDrawer,
  defaultModelOverride: DefaultModelOverrideDrawer,
  addOrEditAnnotationScore: AddOrEditAnnotationScoreDrawer,
  addAnnotationQueue: AddAnnotationQueueDrawer,
  addDatasetRecord: AddDatasetRecordDrawerV2,
  llmModelCost: LLMModelCostDrawer,
  uploadCSV: UploadCSVDrawer,
  addOrEditDataset: AddOrEditDatasetDrawer,
  // Serves URLs handed out before the authoring drawer replaced the filter-only
  // one: the REST `platformUrl` field and the automation emails both used to
  // name this drawer, and those links live in inboxes and in whatever callers
  // stored the response. It points at the same drawer as `automation` so an old
  // link opens the editor that can change a query condition, which the drawer
  // it used to open could not do at all.
  editAutomationFilter: AutomationDrawer,
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
  agentWorkflowTargetEditor: AgentWorkflowTargetEditorDrawer,
  workflowSelector: WorkflowSelectorDrawerFromUrl,
  evaluatorHistory: EvaluatorHistoryDrawer,
  // Experiments workbench
  comparisonLeaderboard: ComparisonLeaderboardDrawer,
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
  scenarioVersionHistory: ScenarioVersionHistoryDrawer,
  // Suites
  suiteEditor: SuiteFormDrawer,
  // Agent Testing v2 draws the same run plan in a dialog of its own.
  agentTestingPlanEditor: AgentTestingPlanModal,
  // Data privacy
  dataPrivacyRule: DataPrivacyRuleDrawer,
  // AI governance
  // Project management
  createProject: CreateProjectDrawer,
  editProject: EditProjectDrawer,
  createTeam: CreateTeamDrawer,
  inviteMember: InviteMemberDrawer,
  // Online Evaluations (Monitors)
  onlineEvaluation: OnlineEvaluationDrawer,
  guardrails: GuardrailsDrawer,
  // Dev tools
  // Ops
  foundry: FoundryDrawer,
  opsGroupDetail: GroupDetailDrawer,
  opsProcessInstance: ProcessInstanceDrawer,
  opsProcessInstances: ProcessInstancesDrawer,
  opsBlobs: OpsBlobsDrawer,
  opsReplay: OpsReplayDrawer,
  // Coding agents
  pullRequestDetail: PullRequestDetailDrawer,
} satisfies Record<string, React.FC<any>>;

/**
 * Union type of all registered drawer names.
 */
export type DrawerType = keyof typeof drawers;

/**
 * Fetch a drawer's code before something opens it.
 *
 * Each drawer is its own download, so the first open of one waits on the
 * network with only the Suspense spinner on screen. A screen that knows which
 * drawer its rows open warms it while the person is still reading, and the
 * click then opens the drawer straight away. The bundler keeps the module, so
 * a repeat call costs nothing, and `traceV2Details` has no chunk of its own to
 * warm because its shell is mounted by the page.
 */
export function preloadDrawer(type: DrawerType): Promise<void> {
  const component = drawers[type];
  const factory = chunkFactories.get(component);
  if (!factory) return Promise.resolve();

  return warmChunk(factory).then((loaded) => (loaded ? primeLazyComponent(component) : undefined));
}

/**
 * Tell a `lazy()` wrapper that its module is already here.
 *
 * The wrapper keeps its own loaded state, apart from the module cache, so a
 * warmed drawer still suspends on its first render and paints the spinner for
 * a moment. Reading the wrapper once outside render settles that state, and
 * the drawer then renders on the first try. The read throws the promise the
 * wrapper is waiting on, which is how a `lazy()` reports that it is not ready
 * yet, so the throw is the expected path and not a failure. Waiting on that
 * promise is what makes the drawer ready by the time this resolves.
 *
 * Called only once the module is in memory: a wrapper that is told to load and
 * fails remembers the failure for the life of the page, which would turn a
 * warm-up that lost the network into a drawer that can never open.
 */
export function primeLazyComponent(component: object): Promise<void> {
  const wrapper = component as {
    _init?: (payload: unknown) => unknown;
    _payload?: unknown;
  };
  if (typeof wrapper._init !== "function") return Promise.resolve();

  try {
    wrapper._init(wrapper._payload);
    return Promise.resolve();
  } catch (pending) {
    // Duck-typed rather than `pending instanceof Promise`. A promise carries
    // the identity of the realm that created it, and `instanceof` compares
    // against the `Promise` of the realm running this line — so the moment the
    // two differ, the check is false for a perfectly good promise and this
    // returns WITHOUT waiting for the chunk. The drawer is then reported as
    // primed while still pending, and renders its spinner after all.
    //
    // A browser has one realm, so this was invisible in production and stayed
    // invisible in tests until the suite moved to a pool that runs each file in
    // a VM context. `then` is what React itself looks for, and what the promise
    // contract actually specifies; realm identity was never the question being
    // asked. (Same class of bug as the `dedupe: ["zod"]` note in CLAUDE.md.)
    // Promise.resolve() adopts the foreign thenable into a real promise of
    // THIS realm, which is both what the signature asks for and the right
    // semantics: a bare PromiseLike carries no `catch`/`finally`, and callers
    // await this like any other promise.
    return isThenable(pending)
      ? Promise.resolve(pending).then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
  }
}

/** Whether a value follows the promise contract, whatever realm made it. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

/**
 * Get the props type for a specific drawer.
 */
export type DrawerProps<T extends DrawerType> = ComponentProps<(typeof drawers)[T]>;

/**
 * Extract only the callback (function) props from a drawer's props.
 * Used for type-safe flow callback registration.
 */
export type DrawerCallbacks<T extends DrawerType> = {
  [
    K in keyof DrawerProps<T> as DrawerProps<T>[K] extends ((...args: any[]) => any) | undefined
      ? K
      : never
  ]?: DrawerProps<T>[K];
};

/**
 * Type for the flow callbacks registry.
 * Maps drawer types to their callback props.
 */
export type FlowCallbacksRegistry = {
  [T in DrawerType]?: DrawerCallbacks<T>;
};
