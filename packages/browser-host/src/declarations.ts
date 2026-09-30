/**
 * What installed modules declared through `withCapabilities`, read by name in
 * install order, so a module's own host can hand a peer's declared component
 * to its screens. ARCHITECTURE.md §10.1, "A capability travels by declaration".
 */

import type { SystemStyleObject } from "@chakra-ui/react";
import type { HttpAuth, HttpHeader, HttpMethod } from "@langwatch/agent-contract";
import type { HttpTestResult } from "@langwatch/agent-contract/http-test";
import type { AnnotationFormState } from "@langwatch/annotation-contract";
import type { CustomGraphInput } from "@langwatch/dashboard-contract";
import type { DatasetColumn, MappingState } from "@langwatch/dataset-contract";
import type { ComparisonEvaluatorConfig, TargetConfig } from "@langwatch/experiment-contract";
import type { LangyKickoffBrief } from "@langwatch/langy-contract";
import type {
  MediaAudioElement,
  MediaPartProps,
  ScenarioParameterDefinition,
} from "@langwatch/scenario-contract";
import type { TimeInput } from "@langwatch/time";
import type { ConversationRoleMode, DisplayPart } from "@langwatch/trace-contract/conversation";
import type {
  AvailableSource,
  Field,
  FieldMapping,
  LLMConfig,
  LocalPromptConfig,
  Signature,
  WorkflowField,
} from "@langwatch/workflow-contract";
import type { ComponentType, ReactElement, ReactNode } from "react";
import type { IconType } from "react-icons";

/** A component a module declares, loaded the first time something draws it. */
export type UiDeclaredComponent<Props> = {
  readonly load: () => Promise<{ readonly default: ComponentType<Props> }>;
};

/** What a surface hands trace's lent agent actions menu: copy a prompt, ask Langy, or read docs. */
export type UiAgentActionsMenuProps = {
  /** Labels the default outline button. Ignored when `trigger` is given. */
  triggerLabel?: string;
  /** The surface's own trigger: one element, because `Menu.Trigger asChild` clones it. */
  trigger?: ReactElement;
  /** Match the sibling buttons of the surface this sits in. */
  size?: "sm" | "md";
  /** Null where the surface knows Langy is out of reach; otherwise `useCanAskLangy` decides. */
  langy: {
    prompt: string;
    label: string;
    hint: string;
    /** Takes the prompt instead of the Langy store, for a surface animating its own composer. */
    onAsk?: (prompt: string) => void;
  } | null;
  copy: {
    /** What the reader gets while the skill is on its way; absent, the setup prompt of `skill`. */
    prompt?: string;
    label: string;
    hint: string;
    copiedTitle: string;
    /** The skill whose instructions the copy carries, when there is one. */
    skill?: string;
    /** A freshly minted token to put in front of those instructions. */
    apiKey?: string;
    /** The endpoint that token belongs to, on a self-hosted deployment. */
    endpoint?: string;
  };
  docs: {
    href: string;
    label: string;
    hint: string;
    /** Overrides the book glyph where the surface reads better with another. */
    icon?: IconType;
  };
};

/** What organization's Authentication overview hands each card. */
export type UiAuthenticationOverviewCardProps = {
  organizationId: string;
  /** `organization:manage`: groups and member provenance are its reads. */
  canReadMembership: boolean;
};

/** What organization's Directory hands the directory status band above its tabs. */
export type UiDirectorySummaryProps = UiAuthenticationOverviewCardProps;

/** What a landing hero hands project's lent inline command palette. */
export type UiHeroAskFieldProps = { placeholder: string };

/** What a screen hands analytics' lent graph: the graph to draw, and what to show when empty. */
export type UiCustomGraphProps = {
  input: CustomGraphInput;
  titleProps?: SystemStyleObject;
  emptyState?: ReactNode;
};

/** What a surface hands navigation's lent command palette, drawn inline rather than as the bar. */
export type UiInlineCommandPaletteProps = { placeholder: string };

/** Project's lent switcher needs nothing handed in: it reads the scope and the graph itself. */
export type UiProjectSwitcherProps = Record<string, never>;

/** Organization's lent card of people waiting to join needs nothing handed in: it reads the scope itself. */
export type UiPendingJoinRequestsProps = Record<string, never>;

/** What project's settings form hands organization's lent department row. */
export type UiProjectDepartmentFieldProps = {
  organizationId: string;
  projectId: string;
  governanceEnabled: boolean;
};

/** What agent's test panel hands scenario's lent parameter line: the agent's own parameters. */
export type UiParameterLineFieldProps = {
  definitions: readonly ScenarioParameterDefinition[];
  value: string;
  onChange: (line: string) => void;
  ariaLabel: string;
  testId: string;
};

/** A dataset column as a dataset surface names it: its name and its type's name. */
export type UiDatasetColumn = DatasetColumn;

/** What a screen hands dataset's lent create-or-edit drawer. */
export type UiAddOrEditDatasetDrawerProps = {
  datasetToSave?: {
    datasetId?: string;
    name?: string;
    columnTypes: UiDatasetColumn[];
    datasetRecords?: ({ id?: string } & Record<string, unknown>)[];
  };
  open?: boolean;
  onClose?: () => void;
  onSuccess?: (dataset: {
    datasetId: string;
    name: string;
    columnTypes: UiDatasetColumn[];
  }) => void;
  /** Apply the form without saving it: the caller holds the dataset in memory. */
  localOnly?: boolean;
  columnVisibility?: {
    hiddenColumns: Set<string>;
    onToggleVisibility: (columnName: string) => void;
  };
  isColumnsLocked?: boolean;
};

/** A dataset a borrower holds in memory, with plain columns, as dataset's lent editor reads it. */
export type UiInMemoryDataset = {
  datasetId?: string;
  name?: string;
  datasetRecords: ({ id: string } & Record<string, unknown>)[];
  columnTypes: UiDatasetColumn[];
};

/** What a screen hands dataset's lent editor table: a saved dataset by id, or one in memory. */
export type UiDatasetEditorTableProps = {
  datasetId?: string;
  inMemoryDataset?: UiInMemoryDataset;
  onUpdateDataset?: (dataset: UiInMemoryDataset & { datasetId?: string }) => void;
  title?: ReactNode;
  headerActions?: ReactNode;
  readEnabled?: boolean;
  floatingSelectionBar?: boolean;
  /** Called after column changes are saved, so the host can follow the new shape. */
  onColumnsChanged?: (columnTypes: UiDatasetColumn[]) => void;
  /** The dialog's portal target, so the floating cell editor stays inside its pointer scope. */
  editorPortalRef?: { readonly current: HTMLDivElement | null };
};

/** What a screen hands dataset's lent record sync, which renders nothing and saves edits. */
/** What a screen hands dataset's lent picker list: whether to fetch yet, and where a pick goes. */
export type UiDatasetPickerListProps = {
  enabled?: boolean;
  onSelect: (dataset: { datasetId: string; name: string; columnTypes: UiDatasetColumn[] }) => void;
};

export type UiDatasetRecordSyncProps = {
  projectId: string | undefined;
  /** dbDatasetId -> recordId -> changed columns; `_delete: true` marks a deletion. */
  pendingSavedChanges: Record<string, Record<string, Record<string, unknown>>>;
  resolveFullRecord: (
    dbDatasetId: string,
    recordId: string,
  ) => ({ id: string } & Record<string, unknown>) | undefined;
  clearPendingChange: (dbDatasetId: string, recordId: string) => void;
  onStatus: (state: "idle" | "saving" | "saved" | "error", error?: string) => void;
};

/** The surface coding-agent's lent activity tables read: where they are, who asks, and toasts. */
export type UiCodingAgentActivityHost = {
  hasPermission(permission: string): boolean;
  route(): {
    params: Readonly<Record<string, string | undefined>>;
    query: Readonly<Record<string, string | undefined>>;
  };
  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;
  navigate(to: string): void;
  succeeded(notice: { title: string; description?: string; id?: string }): void;
  failed(failure: { error: unknown; fallbackTitle: string; id?: string }): void;
};

/** What a screen hands coding-agent's lent pull requests table. */
export type UiCodingAgentPullRequestsTableProps = {
  projectId: string;
  host: UiCodingAgentActivityHost;
};

/** What a screen hands coding-agent's lent sessions table. */
export type UiCodingAgentSessionsTableProps = {
  projectId: string;
  projectSlug: string | null;
  host: UiCodingAgentActivityHost;
};

/** What a screen hands scenario's lent Talk-to-it panel. */
export type UiTalkToItPanelProps = {
  projectId: string;
  projectSlug: string;
  transport: string;
  agentId: string;
  agentRowId?: string;
  name?: string;
  onAgentCreated?: (agentRowId: string) => void;
};

/**
 * What a screen hands the join offer. `currentOrganizationId` is required: a
 * string scopes to that organization, `null` means no organization context
 * (onboarding), `undefined` means the caller's organization is still loading.
 */
export type UiJoinOfferProps = {
  currentOrganizationId: string | null | undefined;
  /** The way past, where "keep working on my own" is not what declining means. */
  dismissLabel?: string;
  onDismissed?: () => void;
  /** A lower-priority prompt, shown only once the join decision resolves to nothing. */
  fallback?: ReactNode;
};

/** What the backoffice license drawer hands the Billing section of a linked license. */
export type UiLicenseBillingSectionProps = {
  organizationId: string;
  organizationName: string;
  email: string;
  issuedAt: string;
  expiresAt: string;
  maxMembers: number;
  seatRateCents: number | null;
  seatCurrency: "USD" | "EUR" | null;
  commitUsdCents: number;
};

/** What a screen hands model-provider's model picker. */
export type UiModelSelectorProps = {
  model: string;
  options: string[];
  onChange: (model: string) => void;
  size?: "sm" | "md" | "full";
  mode?: "chat" | "embedding";
  /** A "Configure available models" link at the bottom of the dropdown. */
  showConfigureAction?: boolean;
  /** Names the feature in the callout shown when no model is available. */
  forFeatureLabel?: string;
};

/** What a screen hands model-provider's display of one chosen model. */
export type UiModelDisplayProps = {
  model: string;
  fontSize?: string;
};

/** What a screen hands model-provider's form for adding or editing one provider's credentials. */
export type UiEditModelProviderFormProps = {
  providerKey: string;
  /** `"new"` adds the provider; otherwise the stored provider being edited. */
  modelProviderId?: string;
  organizationId?: string | undefined;
  projectId?: string | undefined;
  /** What "the credential is saved" means to a surface that is not the settings drawer. */
  onSaved?: (saved: { chatModel?: string }) => void;
  /** Onboarding's presentation: Connect wording, model pills, no settings chrome. */
  guided?: boolean;
  /** Why the connection did not happen: a refused credential, or a sign-in that failed or timed out. */
  onFailed?: (failure: { provider: string; code: string }) => void;
};

/**
 * Playback coordination for one audio part, as the host's sequential player
 * hands it out. The thread never starts a clip; it passes these to the media.
 */
export type UiConversationAudioPlayback = {
  ref: (element: MediaAudioElement | null) => void;
  onPlay: () => void;
  onEnded: () => void;
};

/** Draws one media part; the host owns stored-object probing and playback. */
export type UiRenderMediaPart = (input: {
  part: Extract<DisplayPart, { kind: "media" }>["part"];
  projectId: string;
  audioPlayback?: UiConversationAudioPlayback;
}) => ReactNode;

/** What a screen hands trace's conversation renderer: parts flattened by the trace kit. */
export type UiConversationThreadProps = {
  parts: DisplayPart[];
  /** `compact` is a grid-cell preview: smaller type, no turn separators. */
  variant?: "compact" | "regular";
  /** `scenario` swaps the sides so the agent under test reads as the subject. */
  roleMode?: ConversationRoleMode;
  labels?: { user?: string; assistant?: string };
  /** Owns the stored objects behind any media parts. */
  projectId: string;
  renderPartActions?: (part: DisplayPart) => ReactNode;
  shouldAutoScroll?: boolean;
  /** Draws a reply that parses as JSON as a value tree, not markdown. */
  shouldRenderStructuredOutput?: boolean;
  panel?: { contentMaxWidth: string };
  /** A reply was asked for and has not begun arriving. */
  hasPendingReply?: boolean;
  /** Numbers turns from the start and offers trace affordances as traces land. */
  live?: boolean;
  renderMediaPart: UiRenderMediaPart;
  renderTurnSeparator?: (input: { index: number; traceId?: string; live: boolean }) => ReactNode;
  audioPlaybackFor?: (part: DisplayPart) => UiConversationAudioPlayback | undefined;
};

/** What a screen hands trace's eye-icon peek at one trace. */
export type UiTraceIdPeekProps = {
  traceId: string;
};

/** What a screen hands trace's hover peek around a trigger of its own. */
export type UiTracePreviewHoverCardProps = {
  traceId: string;
  children: ReactNode;
};

/** What annotation's queue walker hands the conversation trace lends it. */
export type UiAnnotationQueueConversationProps = {
  /** The trace the queue item names; its turn is the one under review. */
  traceId: string;
  /** The thread that trace belongs to, or null for a trace in no thread. */
  conversationId: string | null;
};

/** What a screen hands trace's way into correcting one trace. */
export type UiTraceEditButtonProps = {
  traceId: string;
  /** When the trace started, so the drawer reads its partition; null when unknown. */
  occurredAtMs: number | null;
  disabled?: boolean;
};

/** What a screen hands trace's input/output viewer. */
export type UiRenderInputOutputProps = {
  value: unknown;
  showTools?: boolean | "copy-only";
  collapsed?: boolean;
  collapseStringsAfterLength?: number;
  /** Per-node collapse decision, e.g. "start every array collapsed". */
  shouldCollapse?: (field: { type: string }) => boolean;
  /** Show the entry count beside each object and array. */
  displayObjectSize?: boolean;
};

/** What a screen hands workflow's clamped text that expands into a dialog. */
export type UiHoverableBigTextProps = {
  children: ReactNode;
  lineClamp?: number;
  expandedVersion?: string;
  expandable?: boolean;
};

/** What a screen hands workflow's version badge; no version draws an empty badge. */
export type UiVersionBoxProps = {
  version?: { autoSaved?: boolean; version: string };
  minWidth?: string;
  backgroundColor?: string;
};

/** What the experiment workbench hands workflow's "Run via API" dialog. */
export type UiRunExperimentViaApiDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  experimentSlug: string;
  entryFields: WorkflowField[];
  datasetColumns: string[];
  datasetName?: string;
  projectSlug?: string;
};

/** What a screen hands workflow's marker for a trace field the reader may not see. */
export type UiRedactedFieldProps = {
  field: "input" | "output";
  children: ReactNode;
  loadingComponent?: ReactNode;
  redacted?: boolean;
  visibleTo?: string | null;
};

/** An evaluator's name and settings as the studio holds them. */
export type UiEvaluatorEditorValues = { name: string; settings: Record<string, unknown> };

/** What the studio hands evaluator's editor for one saved evaluator node. */
export type UiStudioEvaluatorEditorProps = {
  evaluatorType: string | undefined;
  description: string | undefined;
  isWorkflowEvaluator: boolean;
  workflow:
    | { id: string; name: string; icon?: string | null; updatedAt: string; projectSlug: string }
    | undefined;
  fields: { requiredFields?: string[]; optionalFields?: string[] } | undefined;
  initialValues: UiEvaluatorEditorValues;
  onChange: (values: UiEvaluatorEditorValues) => void;
  mappings: {
    availableSources: AvailableSource[];
    initialMappings: Record<string, FieldMapping>;
    onMappingChange: (identifier: string, mapping: FieldMapping | undefined) => void;
  };
};

/** What the studio hands evaluator's settings form for an inline evaluator node. */
export type UiEvaluatorSettingsFormProps = {
  evaluatorType: string;
  initialSettings: Record<string, unknown>;
  /** Fill in the evaluator's default settings on first render. */
  applyDefaults: boolean;
  onChange: (settings: Record<string, unknown>) => void;
};

/** One declared prompt input or output, as the prompt editor reports it. */
export type UiPromptIOField = { identifier: string; type: string };

/** What the studio hands prompt's editor, embedded in a signature node's panel. */
export type UiStudioPromptEditorProps = {
  nodeData: Signature;
  onClose: () => void;
  promptId: string | undefined;
  promptVersionId: string | undefined;
  initialLocalConfig: LocalPromptConfig | undefined;
  onLocalConfigChange: (config: LocalPromptConfig | undefined) => void;
  onSave: (prompt: {
    id: string;
    name: string;
    version?: number;
    versionId?: string;
    inputs?: UiPromptIOField[];
    outputs?: UiPromptIOField[];
  }) => void;
  onVersionChange: (prompt: {
    version: number;
    versionId: string;
    inputs?: UiPromptIOField[];
    outputs?: UiPromptIOField[];
  }) => void;
  availableSources: AvailableSource[];
  inputMappings: Record<string, FieldMapping>;
  onInputMappingsChange: (identifier: string, mapping: FieldMapping | undefined) => void;
};

/** What a screen hands analytics' filter sidebar; it reads the filters from the URL itself. */
export type UiFilterSidebarProps = { defaultShowFilters?: boolean; hideTopics?: boolean };

/** What a check form hands trace's mapping editor, which reads its own sample traces. */
export type UiEvaluatorTracesMappingProps = {
  targetFields: string[];
  traceMapping?: MappingState;
  setTraceMapping?: (mapping: MappingState) => void;
};

/** What an evaluator editor hands experiment's comparison evaluator form. */
export type UiComparisonConfigFormProps = {
  value: ComparisonEvaluatorConfig;
  onChange: (next: ComparisonEvaluatorConfig) => void;
  targets: TargetConfig[];
  datasetColumns: { id: string; name: string }[];
  datasetName?: string;
};

/** What an HTTP agent's properties panel hands agent's configuration editor. */
export type UiHttpConfigEditorProps = {
  url: string;
  onUrlChange: (url: string) => void;
  method: HttpMethod;
  onMethodChange: (method: HttpMethod) => void;
  bodyTemplate: string;
  onBodyTemplateChange: (body: string) => void;
  outputPath: string;
  onOutputPathChange: (path: string) => void;
  auth: HttpAuth | undefined;
  onAuthChange: (auth: HttpAuth | undefined) => void;
  headers: HttpHeader[];
  onHeadersChange: (headers: HttpHeader[]) => void;
  onTest: (templateVariables: Record<string, unknown>) => Promise<HttpTestResult>;
  paddingX?: number | string;
};

/** One declared output of a prompt, code or agent node. */
export type UiNodeOutput = { identifier: string; type: Field["type"]; json_schema?: object };

/** What a node panel hands prompt's outputs editor. */
export type UiOutputsSectionProps = {
  outputs: UiNodeOutput[];
  onChange: (outputs: UiNodeOutput[]) => void;
  canAddRemove?: boolean;
  readOnly?: boolean;
  title?: string;
  availableTypes?: Field["type"][];
};

/** What a studio node hands prompt's LLM config row; prompt resolves the model option itself. */
export type UiLlmConfigFieldProps = {
  llmConfig: LLMConfig;
  onChange: (llmConfig: LLMConfig) => void;
  requiresCustomKey: boolean;
  showProviderKeyMessage?: boolean;
  outputs?: UiNodeOutput[];
  onOutputsChange?: (outputs: UiNodeOutput[]) => void;
  showStructuredOutputs?: boolean;
};

/** What an evaluator's settings hand prompt's LLM parameter popover. */
export type UiLlmConfigPopoverProps = {
  values: LLMConfig;
  onChange: (llmConfig: LLMConfig) => void;
};

/** What an empty state hands trace's "Setup via Agent" menu. */
export type UiSetupWithAgentButtonProps = {
  surface: "simulations" | "simulationRuns" | "connectedAgents" | "prompts";
  size?: "sm" | "md";
};

/** Operations a module declares, loaded the first time something calls one. */
export type UiDeclaredOperations<Operations> = {
  readonly load: () => Promise<{ readonly default: Operations }>;
};
/** How a device ceremony ended: `cancelled` is a dismissed prompt, not a refusal. */
export type UiCeremonyOutcome =
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false };
/** One passkey the reader holds, as auth lends it. */
export type UiHeldPasskey = {
  id: string;
  name?: string | null;
  createdAt: TimeInput;
  transports?: string | null;
};
/** What auth lends the screen where a reader manages their own passkeys. */
export type UiPasskeyCeremonies = {
  list(): Promise<readonly UiHeldPasskey[]>;
  register(): Promise<UiCeremonyOutcome>;
  rename(input: { id: string; name: string }): Promise<UiCeremonyOutcome>;
  remove(input: { id: string }): Promise<UiCeremonyOutcome>;
};
/** The value, or the refusal as the endpoint answered it, for the registry to read by code. */
export type UiTwoStepAnswer<Value> = { ok: true; value: Value } | { ok: false; error: unknown };
/** What auth lends for setting two-step verification up; no password where the account has none. */
export type UiTwoStepCeremonies = {
  start(input: {
    password?: string;
  }): Promise<UiTwoStepAnswer<{ setupUri: string; backupCodes: readonly string[] }>>;
  confirm(input: { code: string }): Promise<UiTwoStepAnswer<{ confirmed: true }>>;
  regenerateBackupCodes(input: {
    password?: string;
  }): Promise<UiTwoStepAnswer<{ backupCodes: readonly string[] }>>;
};

/** How linking a further sign-in method ended; `reason` is the provider's refusal to show. */
export type UiLinkSignInMethodOutcome = { ok: true } | { ok: false; reason?: string };
/** What auth lends for linking another sign-in method to the reader's own account. */
export type UiSignInMethodLinking = {
  link(input: { provider: string }): Promise<UiLinkSignInMethodOutcome>;
};

/** A usage-against-limit row licensing lends: a limit type it names, or a caller's label. */
export type UiResourceLimitRowProps = { current: number; max?: number } & (
  | { label: string; limitType?: never }
  | { limitType: "members" | "membersLite"; label?: never }
);

/** The product space a guided onboarding offer sits in. */
export type UiGuidedSpace = "project" | "me" | "gateway" | "governance";

/**
 * What a screen hands onboarding's guided offer: the space it sits in, and its own answer to
 * whether that space is already in use (null while unknown, which keeps the offer hidden).
 */
export type UiGuidedOnboardingOfferProps = {
  space: UiGuidedSpace;
  spaceInUse?: boolean | null;
};

/** The guided kickoff a caller hands Langy's panel to send. */
export type UiLangyKickoff = LangyKickoffBrief;

/** What Langy lends onboarding: dock the panel and hand it the guided kickoff. */
export type UiLangyGuidedOnboarding = {
  dock(): void;
  queueKickoff(kickoff: UiLangyKickoff): void;
  /** Calls back once, with the scope the panel announced; returns the release. */
  onScopeAnnounced(announced: (scope: { organizationId: string | null }) => void): () => void;
};

/**
 * What onboarding lends Langy's tour card: whether a tour is on screen, and a replay of one.
 * Both are hooks, read during render.
 */
export type UiGuidedTour = {
  useRunning(): boolean;
  /** The replay: runs `path`'s tour again and records it on the organization, when named. */
  useReplay(): (input: { path: string; organizationId?: string | null }) => void;
};

/**
 * Each capability a peer reads by name, and the shape a declaration must have
 * to fill it: the CORE side of the contract, as `UiSlotProps` is for slots.
 */
/** Annotation's form body in annotate mode, lent to the trace explorer. */
export type UiAnnotateBodyProps = { state: AnnotationFormState };

/** Annotation's form body in suggest mode, diffed against the output it corrects. */
export type UiSuggestBodyProps = { state: AnnotationFormState; originalOutput: string };

/** Annotation's form footer: save, delete and cancel over the same state. */
export type UiAnnotationFormFooterProps = { state: AnnotationFormState; padding: number };

export type UiDeclaredCapabilities = {
  addOrEditDatasetDrawer: UiDeclaredComponent<UiAddOrEditDatasetDrawerProps>;
  agentActionsMenu: UiDeclaredComponent<UiAgentActionsMenuProps>;
  annotateBody: UiDeclaredComponent<UiAnnotateBodyProps>;
  annotationFormFooter: UiDeclaredComponent<UiAnnotationFormFooterProps>;
  annotationQueueConversation: UiDeclaredComponent<UiAnnotationQueueConversationProps>;
  /** A card on the Authentication overview; `section` places it, sign-in first. */
  authenticationOverviewCard: UiDeclaredComponent<UiAuthenticationOverviewCardProps> & {
    readonly section?: "sign-in" | "provisioning";
  };
  conversationThread: UiDeclaredComponent<UiConversationThreadProps>;
  /** The directory's status band, drawn above the Directory's tabs; scim lends it. */
  directorySummary: UiDeclaredComponent<UiDirectorySummaryProps>;
  customGraph: UiDeclaredComponent<UiCustomGraphProps>;
  datasetEditorTable: UiDeclaredComponent<UiDatasetEditorTableProps>;
  datasetPickerList: UiDeclaredComponent<UiDatasetPickerListProps>;
  datasetRecordSync: UiDeclaredComponent<UiDatasetRecordSyncProps>;
  editModelProviderForm: UiDeclaredComponent<UiEditModelProviderFormProps>;
  guidedOnboarding: UiLangyGuidedOnboarding;
  guidedOnboardingOffer: UiDeclaredComponent<UiGuidedOnboardingOfferProps>;
  guidedTour: UiGuidedTour;
  heroAskField: UiDeclaredComponent<UiHeroAskFieldProps>;
  hoverableBigText: UiDeclaredComponent<UiHoverableBigTextProps>;
  inlineCommandPalette: UiDeclaredComponent<UiInlineCommandPaletteProps>;
  joinOffer: UiDeclaredComponent<UiJoinOfferProps>;
  licenseBillingSection: UiDeclaredComponent<UiLicenseBillingSectionProps>;
  comparisonConfigForm: UiDeclaredComponent<UiComparisonConfigFormProps>;
  codingAgentPullRequestsTable: UiDeclaredComponent<UiCodingAgentPullRequestsTableProps>;
  codingAgentSessionsTable: UiDeclaredComponent<UiCodingAgentSessionsTableProps>;
  evaluatorTracesMapping: UiDeclaredComponent<UiEvaluatorTracesMappingProps>;
  evaluatorSettingsForm: UiDeclaredComponent<UiEvaluatorSettingsFormProps>;
  filterSidebar: UiDeclaredComponent<UiFilterSidebarProps>;
  httpConfigEditor: UiDeclaredComponent<UiHttpConfigEditorProps>;
  llmConfigField: UiDeclaredComponent<UiLlmConfigFieldProps>;
  llmConfigPopover: UiDeclaredComponent<UiLlmConfigPopoverProps>;
  mediaPart: UiDeclaredComponent<MediaPartProps>;
  modelDisplay: UiDeclaredComponent<UiModelDisplayProps>;
  modelSelector: UiDeclaredComponent<UiModelSelectorProps>;
  outputsSection: UiDeclaredComponent<UiOutputsSectionProps>;
  parameterLineField: UiDeclaredComponent<UiParameterLineFieldProps>;
  pendingJoinRequests: UiDeclaredComponent<UiPendingJoinRequestsProps>;
  projectDepartmentField: UiDeclaredComponent<UiProjectDepartmentFieldProps>;
  projectSwitcher: UiDeclaredComponent<UiProjectSwitcherProps>;
  passkeys: UiDeclaredOperations<UiPasskeyCeremonies>;
  redactedField: UiDeclaredComponent<UiRedactedFieldProps>;
  renderInputOutput: UiDeclaredComponent<UiRenderInputOutputProps>;
  resourceLimitRow: UiDeclaredComponent<UiResourceLimitRowProps>;
  runExperimentViaApiDialog: UiDeclaredComponent<UiRunExperimentViaApiDialogProps>;
  setupWithAgentButton: UiDeclaredComponent<UiSetupWithAgentButtonProps>;
  signInMethodLinking: UiDeclaredOperations<UiSignInMethodLinking>;
  suggestBody: UiDeclaredComponent<UiSuggestBodyProps>;
  studioEvaluatorEditor: UiDeclaredComponent<UiStudioEvaluatorEditorProps>;
  studioPromptEditor: UiDeclaredComponent<UiStudioPromptEditorProps>;
  talkToItPanel: UiDeclaredComponent<UiTalkToItPanelProps>;
  traceEditButton: UiDeclaredComponent<UiTraceEditButtonProps>;
  traceIdPeek: UiDeclaredComponent<UiTraceIdPeekProps>;
  tracePreviewHoverCard: UiDeclaredComponent<UiTracePreviewHoverCardProps>;
  twoStepVerification: UiDeclaredOperations<UiTwoStepCeremonies>;
  versionBox: UiDeclaredComponent<UiVersionBoxProps>;
};

export type UiDeclaredName = keyof UiDeclaredCapabilities;

/** One module's declaration of a capability. */
export type UiDeclared<Name extends UiDeclaredName> = {
  readonly module: string;
  readonly capability: UiDeclaredCapabilities[Name];
};

/**
 * An installed module as this reader sees it. Any other capability name rides
 * the index signature; one this reader names must have the shape it names.
 */
export type UiDeclaringModule = {
  readonly name: string;
  readonly installation: {
    readonly capabilities: Readonly<Record<string, unknown>> & Partial<UiDeclaredCapabilities>;
  };
};

/** The declarations above this screen. Nothing declared reads as an empty list. */
export abstract class UiDeclarations {
  declared<Name extends UiDeclaredName>(_name: Name): readonly UiDeclared<Name>[] {
    return [];
  }
}

class InstalledUiDeclarations extends UiDeclarations {
  constructor(private readonly modules: readonly UiDeclaringModule[]) {
    super();
  }

  override declared<Name extends UiDeclaredName>(name: Name): readonly UiDeclared<Name>[] {
    return this.modules.flatMap((module) => {
      const named: Partial<UiDeclaredCapabilities> = module.installation.capabilities;
      const capability = named[name];
      return capability === undefined ? [] : [{ module: module.name, capability }];
    });
  }
}

/** What a composition installs: every installed module, in install order. */
export function uiDeclarations(modules: readonly UiDeclaringModule[]): UiDeclarations {
  return new InstalledUiDeclarations(modules);
}

/** A composition that installed no declarations. */
export const NO_UI_DECLARATIONS: UiDeclarations = uiDeclarations([]);
