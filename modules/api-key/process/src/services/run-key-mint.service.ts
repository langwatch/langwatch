import {
  ApiKeyPermissionDeniedError,
  WORKFLOW_RUN_API_KEY_NAME,
  mintRunKeyInputSchema,
  type ApiKeyApi,
  type MintRunKeyInput,
} from "@langwatch/api-key-contract";
import type { AuthzApi, AuthzPrincipalRef } from "@langwatch/authz-contract";
import { nowInstant, toDate } from "@langwatch/time";

import {
  isRunKeyReusable,
  missingRunPermissions,
  runKeyCacheKey,
  runKeyLifetimeMs,
} from "../rules/run-key.rules.ts";

type HeldRunKey = { token: string; expiresAtMs: number };

/**
 * The one place a run's key is minted (ARCHITECTURE.md §10): the starter's or the starting key's,
 * capped by what they hold, or ownerless (the system) for a run nobody started. Shared per (user,
 * key, project, permissions) while it covers the caller's floor; the sweep retires it.
 */
export class RunKeyMintService {
  static create(options: {
    apiKeys: Pick<ApiKeyApi, "create">;
    authz: Pick<AuthzApi, "getScope" | "effectivePermissions">;
  }): RunKeyMintService {
    return new RunKeyMintService(options);
  }

  // ponytail: one entry per user, project and permission set, replaced on re-mint; no eviction.
  readonly #held = new Map<string, Promise<HeldRunKey>>();

  private constructor(
    private readonly options: {
      apiKeys: Pick<ApiKeyApi, "create">;
      authz: Pick<AuthzApi, "getScope" | "effectivePermissions">;
    },
  ) {}

  async mintRunKey(rawInput: MintRunKeyInput): Promise<string> {
    const input = mintRunKeyInputSchema.parse(rawInput);
    const organizationId = await this.checkStarter(input);
    const cacheKey = runKeyCacheKey(input);
    // No await between finding the entry empty and setting it, so runs starting together share
    // one mint.
    for (let existing = this.#held.get(cacheKey); existing; existing = this.#held.get(cacheKey)) {
      const held = await existing.catch(() => undefined);
      const nowMs = nowInstant().epochMilliseconds;
      const { minRemainingMs } = input;
      if (held && isRunKeyReusable({ expiresAtMs: held.expiresAtMs, nowMs, minRemainingMs })) {
        return held.token;
      }
      if (this.#held.get(cacheKey) === existing) {
        this.#held.delete(cacheKey);
        break;
      }
    }

    const pending = this.mint({ ...input, organizationId });
    this.#held.set(cacheKey, pending);
    try {
      return (await pending).token;
    } catch (error) {
      if (this.#held.get(cacheKey) === pending) this.#held.delete(cacheKey);
      throw error;
    }
  }

  // Runs on every request, cached key or not, so a starter who lost a permission is refused
  // before the run rather than at the door partway through it. The starter and the key they
  // started it with must each hold every permission: the narrower wins. Answers the organization.
  private async checkStarter(input: MintRunKeyInput): Promise<string> {
    const scope = await this.options.authz.getScope({ projectId: input.projectId });
    if (scope.type !== "project") throw new ApiKeyPermissionDeniedError("traces:create");
    const principals: AuthzPrincipalRef[] = [];
    if (input.userId !== null) principals.push({ type: "user", id: input.userId });
    if (input.callerApiKeyId) principals.push({ type: "apiKey", id: input.callerApiKeyId });
    for (const principal of principals) {
      const held = await this.options.authz.effectivePermissions({ principal, scope });
      const [missing] = missingRunPermissions({ needed: input.permissions, held });
      if (missing !== undefined) throw new ApiKeyPermissionDeniedError(missing);
    }

    return scope.organizationId;
  }

  private async mint(input: MintRunKeyInput & { organizationId: string }): Promise<HeldRunKey> {
    const expiresAt = nowInstant().add({ milliseconds: runKeyLifetimeMs(input.minRemainingMs) });
    const { token } = await this.options.apiKeys.create({
      isSystemManaged: true,
      name: WORKFLOW_RUN_API_KEY_NAME,
      description:
        "Short-lived key for one run's calls back into LangWatch. Carries only what the run " +
        "uses and expires by itself.",
      userId: input.userId,
      createdByUserId: input.userId,
      // A child of the key that started the run: it dies with it, and is never the system's.
      parentApiKeyId: input.callerApiKeyId ?? null,
      organizationId: input.organizationId,
      permissionMode: "restricted",
      permissions: [...input.permissions],
      bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: input.projectId }],
      expiresAt: toDate(expiresAt),
    });

    return { token, expiresAtMs: expiresAt.epochMilliseconds };
  }
}
