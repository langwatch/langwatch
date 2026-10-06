/**
 * What installed modules declared through `withCapabilities`, read by name in
 * install order, so a module's own host can hand a peer's declared component
 * to its screens. ARCHITECTURE.md §10.1, "A capability travels by declaration".
 */

import type { HttpAuth, HttpHeader, HttpMethod } from "@langwatch/agent-contract";
import type { HttpTestResult } from "@langwatch/agent-contract/http-test";
import type { CustomGraphInput } from "@langwatch/dashboard-contract";
import type { DatasetColumn, MappingState } from "@langwatch/dataset-contract";
import type { SystemStyleObject } from "@langwatch/design-system/primitives";
import type { ComparisonEvaluatorConfig, TargetConfig } from "@langwatch/experiment-contract";
import type { LangyKickoffBrief } from "@langwatch/langy-contract";
import type { UiTokenIdentity } from "@langwatch/module";
import type { MediaAudioElement } from "@langwatch/scenario-contract";
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

/** What a screen hands analytics' lent graph: the graph to draw, and what to show when empty. */
export type UiCustomGraphProps = {
  input: CustomGraphInput;
  titleProps?: SystemStyleObject;
  emptyState?: ReactNode;
};

/** What a surface hands navigation's lent command palette, drawn inline rather than as the bar. */
export type UiInlineCommandPaletteProps = { placeholder: string };

/** Organization's lent card of people waiting to join needs nothing handed in: it reads scope. */
export type UiPendingJoinRequestsProps = Record<string, never>;

/** What project's settings form hands organization's lent department row. */
export type UiProjectDepartmentFieldProps = {
  organizationId: string;
  projectId: string;
  governanceEnabled: boolean;
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
  disableExpansions?: boolean;
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
  /** The saved agent's credentials are shown as "Stored on the agent" and cannot be edited. */
  credentialsReadOnly?: boolean;
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
  surface: "simulations" | "simulationRuns" | "connectedAgents" | "prompts" | "evaluators";
  size?: "sm" | "md";
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
/** Navigation's sidebar groups: fold, unfold, restore each to its remembered preference. */
export type UiNavigationSidebar = {
  expandGroup(id: string): void;
  collapseGroup(id: string): void;
  restoreAll(): void;
};

/** Governance's sample-data choice, written by onboarding's guided tour. */
export type UiGovernanceSampleChoice = { setSampleChoice(choice: boolean): void };

/** Onboarding's guided path; `useIsActive` is a hook, call it during render. */
export type UiGuidedPathActive = { useIsActive(): boolean };

/**
 * Onboarding's first-touch acquisition attribution, lent to the shell.
 * `useCapture` is a hook: the shell calls it at its outermost provider position.
 */
export type UiFirstTouchAttribution = {
  useCapture(): void;
  /**
   * Attribution as analytics event properties, from one source as a whole: the
   * UTM and `ref` params of the current URL when it has any, otherwise the
   * stored first-touch fields.
   */
  eventProperties(): Readonly<Record<string, string>>;
};

export type UiDeclaredCapabilities = {
  addOrEditDatasetDrawer: UiDeclaredComponent<UiAddOrEditDatasetDrawerProps>;
  agentActionsMenu: UiDeclaredComponent<UiAgentActionsMenuProps>;
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
  guidedOnboarding: UiLangyGuidedOnboarding;
  guidedOnboardingOffer: UiDeclaredComponent<UiGuidedOnboardingOfferProps>;
  guidedPathActive: UiGuidedPathActive;
  guidedTour: UiGuidedTour;
  hoverableBigText: UiDeclaredComponent<UiHoverableBigTextProps>;
  inlineCommandPalette: UiDeclaredComponent<UiInlineCommandPaletteProps>;
  joinOffer: UiDeclaredComponent<UiJoinOfferProps>;
  licenseBillingSection: UiDeclaredComponent<UiLicenseBillingSectionProps>;
  comparisonConfigForm: UiDeclaredComponent<UiComparisonConfigFormProps>;
  evaluatorTracesMapping: UiDeclaredComponent<UiEvaluatorTracesMappingProps>;
  evaluatorSettingsForm: UiDeclaredComponent<UiEvaluatorSettingsFormProps>;
  filterSidebar: UiDeclaredComponent<UiFilterSidebarProps>;
  firstTouchAttribution: UiFirstTouchAttribution;
  httpConfigEditor: UiDeclaredComponent<UiHttpConfigEditorProps>;
  llmConfigField: UiDeclaredComponent<UiLlmConfigFieldProps>;
  llmConfigPopover: UiDeclaredComponent<UiLlmConfigPopoverProps>;
  modelDisplay: UiDeclaredComponent<UiModelDisplayProps>;
  modelSelector: UiDeclaredComponent<UiModelSelectorProps>;
  outputsSection: UiDeclaredComponent<UiOutputsSectionProps>;
  pendingJoinRequests: UiDeclaredComponent<UiPendingJoinRequestsProps>;
  projectDepartmentField: UiDeclaredComponent<UiProjectDepartmentFieldProps>;
  redactedField: UiDeclaredComponent<UiRedactedFieldProps>;
  renderInputOutput: UiDeclaredComponent<UiRenderInputOutputProps>;
  resourceLimitRow: UiDeclaredComponent<UiResourceLimitRowProps>;
  runExperimentViaApiDialog: UiDeclaredComponent<UiRunExperimentViaApiDialogProps>;
  sampleChoice: UiGovernanceSampleChoice;
  setupWithAgentButton: UiDeclaredComponent<UiSetupWithAgentButtonProps>;
  sidebar: UiNavigationSidebar;
  studioEvaluatorEditor: UiDeclaredComponent<UiStudioEvaluatorEditorProps>;
  studioPromptEditor: UiDeclaredComponent<UiStudioPromptEditorProps>;
  traceIdPeek: UiDeclaredComponent<UiTraceIdPeekProps>;
  tracePreviewHoverCard: UiDeclaredComponent<UiTracePreviewHoverCardProps>;
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
    readonly lends?: readonly UiLend[];
  };
};

/**
 * What a module lent under a token: a chunk to load, or an eager value.
 * The owner's `.lends` wrote the same payload under the legacy name too.
 */
export type UiLend = Readonly<{ token: UiTokenIdentity }> &
  (Readonly<{ load: () => Promise<unknown> }> | Readonly<{ value: unknown }>);

/** One lend, with the module that made it. */
export type UiLentBy = Readonly<{ module: string; lend: UiLend }>;

export type {
  ReleaseFlagToken,
  UiComponentToken,
  UiDrawerToken,
  UiExtensionToken,
  UiHooksToken,
  UiOperationsToken,
  UiTokenIdentity,
} from "@langwatch/module";

/** The declarations above this screen. Nothing declared reads as an empty list. */
export abstract class UiDeclarations {
  declared<Name extends UiDeclaredName>(_name: Name): readonly UiDeclared<Name>[] {
    return [];
  }

  /** Every lend under this token's key, in install order. */
  lent(_token: UiTokenIdentity): readonly UiLentBy[] {
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

  override lent(token: UiTokenIdentity): readonly UiLentBy[] {
    return this.modules.flatMap((module) =>
      (module.installation.lends ?? [])
        .filter((lend) => lend.token.key === token.key)
        .map((lend) => ({ module: module.name, lend })),
    );
  }
}

/** What a composition installs: every installed module, in install order. */
export function uiDeclarations(modules: readonly UiDeclaringModule[]): UiDeclarations {
  return new InstalledUiDeclarations(modules);
}

/** A composition that installed no declarations. */
export const NO_UI_DECLARATIONS: UiDeclarations = uiDeclarations([]);
