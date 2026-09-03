import type { ApiKey } from "@langwatch/api-key-contract";
import type {
  AuthzGrantsService,
  AuthzLedgerBindingAttach,
  AuthzService,
  LedgerPrincipal,
  LedgerScope,
} from "@langwatch/authz-contract";
import type { ApiKeyDiagnosticsPort } from "../ports/api-key-diagnostics.port";

const MINT_GUARD_TTL_MS = 60_000;
const MINT_GUARD_MAX_ENTRIES = 10_000;

export type AuthzBindingIdDeriver = (input: {
  organizationId: string;
  principal: LedgerPrincipal;
  scope: LedgerScope;
  occurredAtMs: number;
}) => string;

/**
 * Records the implicit organization grant held by credentials created before
 * the AuthZ engine cutover. Authentication never waits for or fails on this
 * compatibility write; Eventing deduplicates its content-derived identity.
 */
export class LegacyApiKeyGrantService {
  private readonly emitted = new Map<string, number>();

  static keyPredatesAuthzEngine(input: {
    apiKey: Pick<ApiKey, "createdAt">;
    cutoverAt: Date | null;
  }): boolean {
    return (
      input.cutoverAt !== null &&
      input.apiKey.createdAt.getTime() < input.cutoverAt.getTime()
    );
  }

  static tryLegacyGrantForApiKey(
    apiKey: ApiKey,
    deriveBindingId: AuthzBindingIdDeriver,
  ): AuthzLedgerBindingAttach | null {
    if (
      apiKey.roleBindings.length > 0 ||
      apiKey.ingestSourceType !== null ||
      apiKey.userId !== null
    ) {
      return null;
    }
    return {
      bindingId: deriveBindingId({
        organizationId: apiKey.organizationId,
        principal: { type: "apiKey", id: apiKey.id },
        scope: { type: "ORGANIZATION", id: apiKey.organizationId },
        occurredAtMs: apiKey.createdAt.getTime(),
      }),
      principal: { apiKeyId: apiKey.id },
      role: "ADMIN",
      customRoleId: null,
      scopeType: "ORGANIZATION",
      scopeId: apiKey.organizationId,
    };
  }

  static create(options: {
    authz: AuthzService;
    grants: AuthzGrantsService;
    deriveBindingId: AuthzBindingIdDeriver;
    diagnostics: ApiKeyDiagnosticsPort;
    now?: () => number;
  }): LegacyApiKeyGrantService {
    return new LegacyApiKeyGrantService(options);
  }

  private constructor(
    private readonly options: {
      authz: AuthzService;
      grants: AuthzGrantsService;
      deriveBindingId: AuthzBindingIdDeriver;
      diagnostics: ApiKeyDiagnosticsPort;
      now?: () => number;
    },
  ) {}

  mint(apiKey: ApiKey): void {
    try {
      const binding = LegacyApiKeyGrantService.tryLegacyGrantForApiKey(
        apiKey,
        this.options.deriveBindingId,
      );
      if (!binding || this.guardHeld(apiKey.id)) {
        return;
      }
      this.holdGuard(apiKey.id);
      void this.persist(apiKey, binding).catch((error: unknown) =>
        this.failed(apiKey, error),
      );
    } catch (error) {
      this.failed(apiKey, error);
    }
  }

  private async persist(
    apiKey: ApiKey,
    binding: AuthzLedgerBindingAttach,
  ): Promise<void> {
    const cutoverAt = await this.options.authz.tryGetEngineCutoverAt({
      organizationId: apiKey.organizationId,
    });
    if (cutoverAt === null) {
      this.emitted.delete(apiKey.id);
      return;
    }
    if (!LegacyApiKeyGrantService.keyPredatesAuthzEngine({ apiKey, cutoverAt })) {
      return;
    }

    await this.options.grants.attachBindings({
      organizationId: apiKey.organizationId,
      bindings: [binding],
      actor: { type: "system", id: "system:read-through-mint" },
      source: "read-through-mint",
      onDuplicate: "skip",
      commandId: `read-through-mint:${apiKey.id}`,
      occurredAtMs: apiKey.createdAt.getTime(),
      awaitProjection: false,
    });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private guardHeld(apiKeyId: string): boolean {
    const expiresAt = this.emitted.get(apiKeyId);
    if (expiresAt === void 0) {
      return false;
    }
    if (this.now() < expiresAt) {
      return true;
    }
    this.emitted.delete(apiKeyId);
    return false;
  }

  private holdGuard(apiKeyId: string): void {
    if (this.emitted.size >= MINT_GUARD_MAX_ENTRIES) {
      this.sweepGuard();
    }
    this.emitted.set(apiKeyId, this.now() + MINT_GUARD_TTL_MS);
  }

  private sweepGuard(): void {
    const now = this.now();
    for (const [apiKeyId, expiresAt] of this.emitted) {
      if (expiresAt <= now) {
        this.emitted.delete(apiKeyId);
      }
    }
    if (this.emitted.size >= MINT_GUARD_MAX_ENTRIES) {
      this.emitted.clear();
    }
  }

  private failed(apiKey: ApiKey, error: unknown): void {
    this.emitted.delete(apiKey.id);
    this.options.diagnostics.warn(
      {
        error,
        apiKeyId: apiKey.id,
        organizationId: apiKey.organizationId,
      },
      "failed to mint the legacy API key grant; authentication continues and the next request retries",
    );
  }
}
