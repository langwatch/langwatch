/**
 * What installed modules declared through `withCapabilities`, read by name in
 * install order, so a module's own host can hand a peer's declared component
 * to its screens. ARCHITECTURE.md §10.1, "A capability travels by declaration".
 */

import type { TimeInput } from "@langwatch/time";
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

/** What an empty state hands trace's "Setup via Agent" menu. */
export type UiSetupWithAgentButtonProps = {
  surface: "simulations" | "simulationRuns";
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
/** What auth lends for setting two-step verification up; no password where the account holds none. */
export type UiTwoStepCeremonies = {
  start(input: {
    password?: string;
  }): Promise<UiTwoStepAnswer<{ setupUri: string; backupCodes: readonly string[] }>>;
  confirm(input: { code: string }): Promise<UiTwoStepAnswer<{ confirmed: true }>>;
  regenerateBackupCodes(input: {
    password?: string;
  }): Promise<UiTwoStepAnswer<{ backupCodes: readonly string[] }>>;
};

/**
 * Each capability a peer reads by name, and the shape a declaration must have
 * to fill it: the CORE side of the contract, as `UiSlotProps` is for slots.
 */
export type UiDeclaredCapabilities = {
  /** A card on the Authentication overview; `section` places it, sign-in first. */
  authenticationOverviewCard: UiDeclaredComponent<UiAuthenticationOverviewCardProps> & {
    readonly section?: "sign-in" | "provisioning";
  };
  joinOffer: UiDeclaredComponent<UiJoinOfferProps>;
  licenseBillingSection: UiDeclaredComponent<UiLicenseBillingSectionProps>;
  modelDisplay: UiDeclaredComponent<UiModelDisplayProps>;
  modelSelector: UiDeclaredComponent<UiModelSelectorProps>;
  passkeys: UiDeclaredOperations<UiPasskeyCeremonies>;
  renderInputOutput: UiDeclaredComponent<UiRenderInputOutputProps>;
  setupWithAgentButton: UiDeclaredComponent<UiSetupWithAgentButtonProps>;
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
