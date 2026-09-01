/**
 * The model-provider feature's application: what its three doors call.
 *
 * `modelProvider.*`, `llmModelCost.*` and `translate.*` are all this feature
 * answering, and before this each declared its own private bag —
 * `Readonly<{ modelProviders: ModelProviderService }>` in two of them and
 * `Readonly<{ modelProviders; traces: { spans } }>` in the third. Three
 * descriptions of one composition, agreeing by attention rather than by
 * construction, and none of them reachable from the others.
 *
 * Most operations are the service's own, reached through the dependency below.
 * What lives here as a method is what a door would otherwise have to know:
 *
 *   - attributing a write to its caller. Eleven handlers stamped it for
 *     themselves, under two different field names (`actorId` on every write,
 *     `authorId` as well on a default assignment), which is exactly the kind
 *     of detail a transport should never be trusted to get right twice;
 *   - pointing the coding-assistant roles at the Codex model, which
 *     `codexSignInPoll` and `codexApplyCodingDefaults` each looped over for
 *     themselves with the same two roles and the same model.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and a
 * background job without knowing which it is serving.
 */
import {
  CODEX_DEFAULT_MODEL,
  type ModelCost,
  type ModelCostDeleteInput,
  type ModelCostListInput,
  type ModelCostWriteInput,
  type ModelDefaultAssignmentInput,
  type ModelDefaultConfig,
  type ModelDefaultConfigWriteInput,
  type ModelDefaultDeleteInput,
  type ModelDefaultEffective,
  type ModelDefaultInheritedValues,
  type ModelDefaultResolveInput,
  type ModelDefaultScope,
  type ModelDefaultSnapshot,
  type ModelDefaultSnapshotInput,
  type ModelProvider,
  type ModelProviderCodexStatus,
  type ModelProviderCodexStatusInput,
  type ModelProviderCredentialVerdict,
  type ModelProviderDeleteInput,
  type ModelProviderListOrganizationInput,
  type ModelProviderListProjectInput,
  type ModelProviderService,
  type ModelProviderSummary,
  type ModelProviderTestConnectionInput,
  type ModelProviderWriteInput,
  type TranslateInput,
  type TranslateOutput,
} from "@langwatch/model-provider-contract";

/** Who a write is attributed to. */
export interface ModelProviderCaller {
  readonly id: string;
}

/**
 * The process's span reader, opaque here. Only the process knows its concrete
 * type; this application carries the handle so the cost-rule preview reads
 * through the SAME request-scoped services as the rest of the call rather than
 * a process singleton.
 */
export type SpanReader = unknown;

/** What the process composes this feature's application from. */
export interface ModelProviderAppDependencies {
  modelProviders: ModelProviderService;
  /** The request's span reader, for the cost-rule preview. */
  spans: SpanReader;
}

/**
 * The two roles a Codex account is licensed for: Langy's own, and the Fast
 * tier. The Default role — playground, evaluators, workflows — is deliberately
 * untouched, because those are not coding surfaces.
 */
const CODEX_CODING_ROLES = ["LANGY", "FAST"] as const;

export class ModelProviderApp {
  static create(dependencies: ModelProviderAppDependencies): ModelProviderApp {
    return new ModelProviderApp(dependencies);
  }

  private constructor(private readonly dependencies: ModelProviderAppDependencies) {}

  // ── providers ──────────────────────────────────────────────────────────────

  /** The project's providers, narrowest scope per provider key, keys masked. */
  getForProject(
    input: ModelProviderListProjectInput & { provider?: string },
  ): Promise<Record<string, ModelProviderSummary>> {
    return this.dependencies.modelProviders.getForProject(input);
  }

  /** Every stored provider row the project can see, keys masked. */
  listForProject(input: ModelProviderListProjectInput): Promise<ModelProviderSummary[]> {
    return this.dependencies.modelProviders.listForProject(input);
  }

  /** Every provider attached anywhere inside the organization, keys masked. */
  listForOrganization(
    input: ModelProviderListOrganizationInput,
  ): Promise<ModelProviderSummary[]> {
    return this.dependencies.modelProviders.listForOrganization(input);
  }

  /** Stores or replaces a provider row, attributed to the caller. */
  upsert(
    input: Omit<ModelProviderWriteInput, "actorId">,
    by: ModelProviderCaller,
  ): Promise<ModelProvider> {
    return this.dependencies.modelProviders.upsert({ ...input, actorId: by.id });
  }

  /** Removes a provider row, attributed to the caller. */
  delete(
    input: Omit<ModelProviderDeleteInput, "actorId">,
    by: ModelProviderCaller,
  ): Promise<void> {
    return this.dependencies.modelProviders.delete({ ...input, actorId: by.id });
  }

  /** Probes a credential that is already stored, attributed to the caller. */
  testConnection(
    input: Omit<ModelProviderTestConnectionInput, "actorId">,
    by: ModelProviderCaller,
  ): Promise<ModelProviderCredentialVerdict> {
    return this.dependencies.modelProviders.testConnection({ ...input, actorId: by.id });
  }

  /**
   * The composed provider service, for the two process capabilities that are
   * written against it rather than against this application.
   *
   * Deliberately narrow and deliberately named: the stored-credential probe
   * reaches the provider's network and takes the service as an argument, and
   * the process owns that function. A door asks the application for the
   * collaborator instead of holding a service of its own, which is the point;
   * when the probe's contract is rewritten to take an operation rather than a
   * service, this accessor goes with it.
   *
   * It is an accessor rather than a wrapper method on purpose. A wrapper would
   * have to be generic over the probe's result, and TypeScript resolves that
   * against the constraint rather than the concrete port a process wires in —
   * which would collapse the router's inferred output type to `unknown`, the
   * exact loss the `TPorts` parameter on each transport exists to prevent.
   */
  get providerService(): ModelProviderService {
    return this.dependencies.modelProviders;
  }

  /** Whether LangWatch itself supplies this provider's credentials. */
  isManagedProvider(input: Readonly<{ organizationId: string; provider: string }>): boolean {
    return this.dependencies.modelProviders.isManagedProvider(input);
  }

  // ── the Codex account ──────────────────────────────────────────────────────

  /** The connected Codex account for a project. Never a token, never an email. */
  getCodexStatus(input: ModelProviderCodexStatusInput): Promise<ModelProviderCodexStatus> {
    return this.dependencies.modelProviders.getCodexStatus(input);
  }

  /**
   * Points the coding-assistant roles at the Codex model.
   *
   * Role-level writes rather than per-feature ones, at the widest scope the
   * caller picked: the values cascade down from there. Written here because
   * both the sign-in poll and the after-the-fact "yes please" dialog perform
   * exactly this, and two copies of "which roles a Codex account serves" is
   * two chances to answer it differently.
   */
  async applyCodexCodingDefaults(
    input: Readonly<{ scopes: readonly ModelDefaultScope[] }>,
    by: ModelProviderCaller,
  ): Promise<void> {
    // One scope is the norm — the sign-in surfaces pick the widest manageable
    // one — so this is scopes[0] in practice.
    const scope = input.scopes[0];
    if (!scope) return;
    for (const role of CODEX_CODING_ROLES) {
      await this.setDefault({ scope, key: role, model: CODEX_DEFAULT_MODEL }, by);
    }
  }

  // ── default models ─────────────────────────────────────────────────────────

  /** What the cascade resolves for one feature key, or null when nothing is set. */
  tryGetResolvedDefault(input: ModelDefaultResolveInput): Promise<ModelDefaultEffective | null> {
    return this.dependencies.modelProviders.tryGetResolvedDefault(input);
  }

  /** The Default Models settings page's snapshot, scoped to what the caller may write. */
  getDefaultSnapshot(
    input: Omit<ModelDefaultSnapshotInput, "actorId">,
    by: ModelProviderCaller,
  ): Promise<ModelDefaultSnapshot> {
    return this.dependencies.modelProviders.getDefaultSnapshot({ ...input, actorId: by.id });
  }

  /**
   * Assigns one role or feature key at one scope, attributed to the caller.
   *
   * The service takes the caller twice — as the author of the value and as the
   * actor of the write — and they are always the same person. Filling both
   * here is what stops a handler filling one and forgetting the other.
   */
  setDefault(
    input: Omit<ModelDefaultAssignmentInput, "actorId" | "authorId">,
    by: ModelProviderCaller,
  ): Promise<void> {
    return this.dependencies.modelProviders.setDefault({
      ...input,
      authorId: by.id,
      actorId: by.id,
    });
  }

  /** Saves a whole default-models config and its scope attachments. */
  saveDefaultConfig(
    input: Omit<ModelDefaultConfigWriteInput, "actorId" | "authorId">,
    by: ModelProviderCaller,
  ): Promise<ModelDefaultConfig> {
    return this.dependencies.modelProviders.saveDefaultConfig({
      ...input,
      authorId: by.id,
      actorId: by.id,
    });
  }

  /** Deletes a default-models config and every scope attachment it holds. */
  deleteDefaultConfig(
    input: Omit<ModelDefaultDeleteInput, "actorId">,
    by: ModelProviderCaller,
  ): Promise<void> {
    return this.dependencies.modelProviders.deleteDefaultConfig({ ...input, actorId: by.id });
  }

  /** What the cascade would hand back for these scopes if they held nothing. */
  getInheritedValues(
    input: Readonly<{
      projectId: string;
      scopes: ModelDefaultScope[];
      excludeConfigId?: string;
    }>,
  ): Promise<ModelDefaultInheritedValues> {
    return this.dependencies.modelProviders.getInheritedValues(input);
  }

  // ── model costs ────────────────────────────────────────────────────────────

  /** The project's custom cost rules. */
  listCosts(input: ModelCostListInput): Promise<ModelCost[]> {
    return this.dependencies.modelProviders.listCosts(input);
  }

  /** Writes one cost rule at a scope the caller may manage, attributed to them. */
  upsertCost(
    input: Omit<ModelCostWriteInput, "actorId">,
    by: ModelProviderCaller,
  ): Promise<ModelCost> {
    return this.dependencies.modelProviders.upsertCost({ ...input, actorId: by.id });
  }

  /** Removes one cost rule, authorized against the STORED row's scope. */
  deleteCost(
    input: Omit<ModelCostDeleteInput, "actorId">,
    by: ModelProviderCaller,
  ): Promise<void> {
    return this.dependencies.modelProviders.deleteCost({ ...input, actorId: by.id });
  }

  /**
   * This request's span reader, for the process's cost-rule preview.
   *
   * The preview reads the trace store, which is another feature's persistence,
   * so it stays the process's function; what this application owns is which
   * reader it runs against — the request's, not a process singleton. An
   * accessor for the same reason as {@link providerService}.
   */
  get spanReader(): SpanReader {
    return this.dependencies.spans;
  }

  // ── translation ────────────────────────────────────────────────────────────

  /** Translates content the caller is already looking at. */
  translate(input: TranslateInput): Promise<TranslateOutput> {
    return this.dependencies.modelProviders.translate(input);
  }
}
