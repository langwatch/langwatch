/**
 * What installed modules declared through `withCapabilities`, read by name in
 * install order, so a module's own host can hand a peer's declared component
 * to its screens. ARCHITECTURE.md §10.1, "A capability travels by declaration".
 */

import type { ScenarioParameterDefinition } from "@langwatch/scenario-contract";
import type { TimeInput } from "@langwatch/time";
import type { ConversationRoleMode, DisplayPart } from "@langwatch/trace-contract/conversation";
import type { ComponentType, ReactNode } from "react";

/** A component a module declares, loaded the first time something draws it. */
export type UiDeclaredComponent<Props> = {
  readonly load: () => Promise<{ readonly default: ComponentType<Props> }>;
};

/** What organization's Authentication overview hands each card. */
export type UiAuthenticationOverviewCardProps = {
  organizationId: string;
  /** `organization:manage`: groups and member provenance are its reads. */
  canReadMembership: boolean;
};

/** What a landing hero hands project's lent inline command palette. */
export type UiHeroAskFieldProps = { placeholder: string };

/** What agent's test panel hands scenario's lent parameter line: the agent's own parameters. */
export type UiParameterLineFieldProps = {
  definitions: readonly ScenarioParameterDefinition[];
  value: string;
  onChange: (line: string) => void;
  ariaLabel: string;
  testId: string;
};

/** A dataset column as a dataset surface names it: its name and its type's name. */
export type UiDatasetColumn = { name: string; type: string };

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
  onSaved?: () => void;
  /** Onboarding's presentation: Connect wording, model pills, no settings chrome. */
  guided?: boolean;
};

/**
 * Playback coordination for one audio part, as the host's sequential player
 * hands it out. The thread never starts a clip; it passes these to the media.
 */
export type UiConversationAudioPlayback = {
  ref: (element: HTMLAudioElement | null) => void;
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

/** What a screen hands workflow's marker for a trace field the reader may not see. */
export type UiRedactedFieldProps = {
  field: "input" | "output";
  children: ReactNode;
  loadingComponent?: ReactNode;
  redacted?: boolean;
  visibleTo?: string | null;
};

/** What an empty state hands trace's "Setup via Agent" menu. */
export type UiSetupWithAgentButtonProps = {
  surface: "simulations" | "simulationRuns" | "connectedAgents";
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

/**
 * Each capability a peer reads by name, and the shape a declaration must have
 * to fill it: the CORE side of the contract, as `UiSlotProps` is for slots.
 */
export type UiDeclaredCapabilities = {
  addOrEditDatasetDrawer: UiDeclaredComponent<UiAddOrEditDatasetDrawerProps>;
  annotationQueueConversation: UiDeclaredComponent<UiAnnotationQueueConversationProps>;
  /** A card on the Authentication overview; `section` places it, sign-in first. */
  authenticationOverviewCard: UiDeclaredComponent<UiAuthenticationOverviewCardProps> & {
    readonly section?: "sign-in" | "provisioning";
  };
  conversationThread: UiDeclaredComponent<UiConversationThreadProps>;
  datasetEditorTable: UiDeclaredComponent<UiDatasetEditorTableProps>;
  datasetRecordSync: UiDeclaredComponent<UiDatasetRecordSyncProps>;
  editModelProviderForm: UiDeclaredComponent<UiEditModelProviderFormProps>;
  heroAskField: UiDeclaredComponent<UiHeroAskFieldProps>;
  hoverableBigText: UiDeclaredComponent<UiHoverableBigTextProps>;
  joinOffer: UiDeclaredComponent<UiJoinOfferProps>;
  licenseBillingSection: UiDeclaredComponent<UiLicenseBillingSectionProps>;
  modelDisplay: UiDeclaredComponent<UiModelDisplayProps>;
  modelSelector: UiDeclaredComponent<UiModelSelectorProps>;
  parameterLineField: UiDeclaredComponent<UiParameterLineFieldProps>;
  passkeys: UiDeclaredOperations<UiPasskeyCeremonies>;
  redactedField: UiDeclaredComponent<UiRedactedFieldProps>;
  renderInputOutput: UiDeclaredComponent<UiRenderInputOutputProps>;
  resourceLimitRow: UiDeclaredComponent<UiResourceLimitRowProps>;
  setupWithAgentButton: UiDeclaredComponent<UiSetupWithAgentButtonProps>;
  signInMethodLinking: UiDeclaredOperations<UiSignInMethodLinking>;
  talkToItPanel: UiDeclaredComponent<UiTalkToItPanelProps>;
  traceEditButton: UiDeclaredComponent<UiTraceEditButtonProps>;
  traceIdPeek: UiDeclaredComponent<UiTraceIdPeekProps>;
  tracePreviewHoverCard: UiDeclaredComponent<UiTracePreviewHoverCardProps>;
  twoStepVerification: UiDeclaredOperations<UiTwoStepCeremonies>;
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
