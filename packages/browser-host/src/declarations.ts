/**
 * What installed modules declared through `withCapabilities`, read by name in
 * install order, so a module's own host can hand a peer's declared component
 * to its screens. ARCHITECTURE.md §10.1, "A capability travels by declaration".
 */

import type { DatasetColumn, MappingState } from "@langwatch/dataset-contract";
import type { UiTokenIdentity } from "@langwatch/module";
import type {
  AvailableSource,
  Field,
  FieldMapping,
  LLMConfig,
  LocalPromptConfig,
  Signature,
} from "@langwatch/workflow-contract";
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

/** What organization's Directory hands the directory status band above its tabs. */
export type UiDirectorySummaryProps = UiAuthenticationOverviewCardProps;

;

/** A dataset column as a dataset surface names it: its name and its type's name. */
export type UiDatasetColumn = DatasetColumn;

/** What trace hands dataset's create-or-edit drawer by name, until it opens the client token. */
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
  /** Where a request made from here comes from (ADR-171 v6); `cli` lands a Developer seat. */
  origin?: "web" | "cli";
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

/** What a check form hands trace's mapping editor, which reads its own sample traces. */
export type UiEvaluatorTracesMappingProps = {
  targetFields: string[];
  traceMapping?: MappingState;
  setTraceMapping?: (mapping: MappingState) => void;
  disableExpansions?: boolean;
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
  /** Models LangWatch serves itself, offered first even with no provider configured. */
  builtInModels?: readonly { value: string; label: string }[];
};

/** A usage-against-limit row licensing lends: a limit type it names, or a caller's label. */
export type UiResourceLimitRowProps = { current: number; max?: number } & (
  | { label: string; limitType?: never }
  | { limitType: "members" | "membersLite"; label?: never }
);

/**
 * Each capability a peer reads by name, and the shape a declaration must have
 * to fill it: the CORE side of the contract.
 */
export type UiDeclaredCapabilities = {
  /** A card on the Authentication overview; `section` places it, sign-in first. */
  authenticationOverviewCard: UiDeclaredComponent<UiAuthenticationOverviewCardProps> & {
    readonly section?: "sign-in" | "provisioning";
  };
  /** The directory's status band, drawn above the Directory's tabs; scim lends it. */
  directorySummary: UiDeclaredComponent<UiDirectorySummaryProps>;
  joinOffer: UiDeclaredComponent<UiJoinOfferProps>;
  licenseBillingSection: UiDeclaredComponent<UiLicenseBillingSectionProps>;
  evaluatorTracesMapping: UiDeclaredComponent<UiEvaluatorTracesMappingProps>;
  llmConfigField: UiDeclaredComponent<UiLlmConfigFieldProps>;
  llmConfigPopover: UiDeclaredComponent<UiLlmConfigPopoverProps>;
  outputsSection: UiDeclaredComponent<UiOutputsSectionProps>;
  resourceLimitRow: UiDeclaredComponent<UiResourceLimitRowProps>;
  studioEvaluatorEditor: UiDeclaredComponent<UiStudioEvaluatorEditorProps>;
  studioPromptEditor: UiDeclaredComponent<UiStudioPromptEditorProps>;
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
