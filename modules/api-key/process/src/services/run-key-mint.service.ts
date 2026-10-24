import {
  ApiKeyPermissionDeniedError,
  WORKFLOW_RUN_API_KEY_NAME,
  mintRunKeyInputSchema,
  type CreateApiKeyInput,
  type MintRunKeyInput,
} from "@langwatch/api-key-contract";
import {
  AuthzGrantNotConfirmedError,
  type AuthzApi,
  type AuthzPrincipalRef,
} from "@langwatch/authz-contract";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import {
  SharedCredentialPendingError,
  mintOnce,
  type SharedCredentialHold,
  type SharedCredentialStore,
} from "@langwatch/secrets/shared-credential";
import { Temporal, nowInstant, toDate, type Instant } from "@langwatch/time";
import { z } from "zod";

import {
  isRunKeyReusable,
  missingRunPermissions,
  runKeyCacheKey,
  runKeyLifetimeMs,
} from "../rules/run-key.rules.ts";
import type { DisabledApiKey } from "./api-key-lifecycle.service.ts";
import type { ApiKeyService } from "./api-key.service.ts";

type HeldRunKey = { token: string; expiresAtMs: number };
type RunKeyWriter = Pick<ApiKeyService, "writeDisabled" | "reopenDisabled"> & {
  grantAndActivate(key: DisabledApiKey): Promise<{ token: string }>;
};

/**
 * The one place a run's key is minted (ARCHITECTURE.md §10): the starter's or the starting key's,
 * capped by what they hold, or ownerless (the system) for a run nobody started. Shared per (user,
 * key, project, permissions) while it covers the caller's floor; the sweep retires it.
 */
export class RunKeyMintService {
  static create(options: {
    apiKeys: RunKeyWriter;
    authz: Pick<AuthzApi, "getScope" | "effectivePermissions">;
    held: SharedCredentialStore;
  }): RunKeyMintService {
    return new RunKeyMintService(options);
  }

  // ponytail: one entry per user, project and permission set, replaced on re-mint; no eviction.
  readonly #held = new Map<string, Promise<HeldRunKey>>();

  private constructor(
    private readonly options: {
      apiKeys: RunKeyWriter;
      authz: Pick<AuthzApi, "getScope" | "effectivePermissions">;
      held: SharedCredentialStore;
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

    const pending = this.mint({ ...input, organizationId, cacheKey });
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

  /**
   * Minted once across every server (`mintOnce`): the claimant writes the key, shares it sealed
   * while its grants fold, then shares it active; every other server waits for that same token. A
   * key whose grants have not landed is granted again by the next attempt, never written anew.
   */
  private async mint(
    input: MintRunKeyInput & { organizationId: string; cacheKey: string },
  ): Promise<HeldRunKey> {
    const { minRemainingMs } = input;
    const reusable = (shared: SharedRunKey) =>
      isRunKeyReusable({
        expiresAtMs: shared.expiresAtMs,
        nowMs: nowInstant().epochMilliseconds,
        minRemainingMs,
      });
    try {
      const value = await mintOnce({
        store: this.options.held,
        address: { tenantId: input.projectId, contentKey: input.cacheKey },
        isReady: (held) =>
          sharedRunKeys([held]).some((shared) => shared.active && reusable(shared)),
        mint: async ({ earlier, hold }) => {
          const [pending] = sharedRunKeys(earlier).filter(
            (shared) => !shared.active && reusable(shared),
          );
          const { shared, key } = pending
            ? await this.reopenShared({ input, pending })
            : await this.writeShared({ input, hold });
          await this.options.apiKeys.grantAndActivate(key);
          const ttlMs = shared.expiresAtMs - nowInstant().epochMilliseconds;
          return { value: JSON.stringify({ ...shared, active: true }), ttlMs };
        },
      });
      const [shared] = sharedRunKeys([value]);
      if (!shared) throw new Error("The shared run key could not be read back");
      return { token: shared.token, expiresAtMs: shared.expiresAtMs };
    } catch (error) {
      if (
        error instanceof SharedCredentialPendingError ||
        (AuthzGrantNotConfirmedError.is(error) && !readHandledError(error)?.retryable)
      ) {
        throw new AuthzGrantNotConfirmedError({ retryable: true });
      }
      throw error;
    }
  }

  /** Writes the run's key revoked and shares it before its grants, so a retry resumes it. */
  private async writeShared({
    input,
    hold,
  }: {
    input: MintRunKeyInput & { organizationId: string };
    hold: (held: SharedCredentialHold) => Promise<void>;
  }): Promise<{ shared: SharedRunKey; key: DisabledApiKey }> {
    const lifetimeMs = runKeyLifetimeMs(input.minRemainingMs);
    const expiresAt = nowInstant().add({ milliseconds: lifetimeMs });
    const key = await this.options.apiKeys.writeDisabled(createInput({ input, expiresAt }));
    const shared = {
      apiKeyId: key.id,
      token: key.token,
      expiresAtMs: expiresAt.epochMilliseconds,
      active: false,
    };
    await hold({ value: JSON.stringify(shared), ttlMs: lifetimeMs });
    return { shared, key };
  }

  /** The key an earlier attempt wrote and shared, to be granted again with the same token. */
  private async reopenShared({
    input,
    pending,
  }: {
    input: MintRunKeyInput & { organizationId: string };
    pending: SharedRunKey;
  }): Promise<{ shared: SharedRunKey; key: DisabledApiKey }> {
    const expiresAt = Temporal.Instant.fromEpochMilliseconds(pending.expiresAtMs);
    const key = await this.options.apiKeys.reopenDisabled({
      id: pending.apiKeyId,
      token: pending.token,
      input: createInput({ input, expiresAt }),
    });
    return { shared: pending, key };
  }
}

/** A run's key as every server shares it, sealed: its token and whether its grants have landed. */
const sharedRunKeySchema = z.object({
  apiKeyId: z.string(),
  token: z.string(),
  expiresAtMs: z.number(),
  active: z.boolean(),
});
type SharedRunKey = z.infer<typeof sharedRunKeySchema>;

/** The held values that read as a run key; one written in another shape is minted over. */
function sharedRunKeys(values: readonly string[]): SharedRunKey[] {
  return values.flatMap((value) => {
    const parsed = sharedRunKeySchema.safeParse(parseJson(value));
    return parsed.success ? [parsed.data] : [];
  });
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** The run's key: restricted to what the run needs, bound to its project, expiring by itself. */
function createInput({
  input,
  expiresAt,
}: {
  input: MintRunKeyInput & { organizationId: string };
  expiresAt: Instant;
}): CreateApiKeyInput {
  return {
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
  };
}
