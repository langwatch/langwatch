import { ApiKeyAlreadyRevokedError, type CreateApiKeyInput } from "@langwatch/api-key-contract";
import { AuthzGrantNotConfirmedError } from "@langwatch/authz-contract";
import {
  SharedCredentialPendingError,
  mintOnce,
  type SharedCredentialAddress,
  type SharedCredentialHold,
  type SharedCredentialStore,
} from "@langwatch/secrets/shared-credential";
import { Temporal, nowInstant, type Instant } from "@langwatch/time";
import { z } from "zod";

import type { ApiKeyRepository } from "../repositories/api-key.repository.ts";
import type { DisabledApiKey } from "./api-key-lifecycle.service.ts";
import type { ApiKeyService } from "./api-key.service.ts";

/** The key writes a mint needs: write disabled, reopen, then grant and activate. */
export type SharedKeyWriter = Pick<ApiKeyService, "writeDisabled" | "reopenDisabled"> & {
  grantAndActivate(key: DisabledApiKey): Promise<{ token: string }>;
};

/** Mints keys shared across servers; `mint` documents the contract. */
export class SharedKeyMintService {
  static create(options: {
    apiKeys: SharedKeyWriter;
    keys: Pick<ApiKeyRepository, "findById">;
  }): SharedKeyMintService {
    return new SharedKeyMintService(options);
  }

  private constructor(
    private readonly options: {
      apiKeys: SharedKeyWriter;
      keys: Pick<ApiKeyRepository, "findById">;
    },
  ) {}

  /**
   * Mints a key once across every server (`mintOnce`): written and shared sealed, then shared
   * active once its grants fold. A retry grants the pending key again, never writes a new one,
   * unless it was revoked on purpose. `written` marks the call that activated it.
   */
  mint(
    input: Omit<Mint, "apiKeys" | "isPending">,
  ): Promise<{ token: string; apiKeyId: string; expiresAtMs: number; written: boolean }> {
    const { apiKeys, keys } = this.options;
    return mintShared({
      ...input,
      apiKeys,
      isPending: async (apiKeyId) => {
        const row = await keys.findById({ id: apiKeyId });
        return row !== null && row.revocationCause === null;
      },
    });
  }
}

/** A key as every server shares it, sealed: its token, and whether its grants have landed. */
const sharedKeySchema = z.object({
  apiKeyId: z.string(),
  token: z.string(),
  expiresAtMs: z.number(),
  active: z.boolean(),
  /** Whose key it is, so a held value never serves another identity at the same address. */
  identity: z.string().optional(),
});
type SharedKey = z.infer<typeof sharedKeySchema>;

/** The held values that read as a shared key; one written in another shape is minted over. */
function sharedKeys(values: readonly string[]): SharedKey[] {
  return values.flatMap((value) => {
    const parsed = sharedKeySchema.safeParse(parseJson(value));
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

async function mintShared(input: {
  apiKeys: SharedKeyWriter;
  store: SharedCredentialStore;
  address: SharedCredentialAddress;
  /** Stamped on the shared value; a value of another identity is never reused. */
  identity?: string;
  /** The expiry of a key about to be written. */
  newExpiresAt: () => Instant;
  /** The key to write, or to reopen when an earlier attempt already wrote it. */
  keyFor: (expiresAt: Instant) => CreateApiKeyInput;
  /** Whether a shared key still serves this caller (long enough, say). */
  reusable: (shared: { expiresAtMs: number }) => boolean;
  /** Whether the key's row is still live: a key retired elsewhere is minted over. */
  isLive?: (apiKeyId: string) => Promise<boolean>;
  /** Whether a pending key is still only disabled; one revoked since is minted over. */
  isPending?: (apiKeyId: string) => Promise<boolean>;
  /** Told to a caller whose grant has not landed, so its retry waits for the fold. */
  retryAfterMs?: number;
}): Promise<{ token: string; apiKeyId: string; expiresAtMs: number; written: boolean }> {
  const { apiKeys, identity } = input;
  const ours = (shared: SharedKey) => shared.identity === identity;
  let written = false;
  try {
    const value = await mintOnce({
      store: input.store,
      address: input.address,
      isReady: async (held) => {
        const [shared] = sharedKeys([held]);
        return (
          shared !== undefined &&
          shared.active &&
          ours(shared) &&
          input.reusable(shared) &&
          (input.isLive ? await input.isLive(shared.apiKeyId) : true)
        );
      },
      mint: async ({ earlier, hold }) => {
        const pending = await firstPending({
          candidates: sharedKeys(earlier).filter(
            (shared) => !shared.active && ours(shared) && input.reusable(shared),
          ),
          isPending: input.isPending,
        });
        const { shared, key } =
          pending.kind === "pending"
            ? await reopen({ apiKeys, pending: pending.shared, input })
            : await write({ apiKeys, hold, input });
        await apiKeys.grantAndActivate(key);
        // Counted where the key goes live: a key written by one try, activated by another, is one.
        written = true;
        const ttlMs = shared.expiresAtMs - nowInstant().epochMilliseconds;
        return { value: JSON.stringify({ ...shared, active: true }), ttlMs };
      },
    });
    const [shared] = sharedKeys([value]);
    if (!shared) throw new Error("The shared key could not be read back");
    return { ...shared, written };
  } catch (error) {
    if (
      error instanceof SharedCredentialPendingError ||
      ApiKeyAlreadyRevokedError.is(error) ||
      (AuthzGrantNotConfirmedError.is(error) && !error.retryable)
    ) {
      throw new AuthzGrantNotConfirmedError({
        retryable: true,
        ...(input.retryAfterMs ? { retryAfterMs: input.retryAfterMs } : {}),
      });
    }
    throw error;
  }
}

async function firstPending({
  candidates,
  isPending,
}: {
  candidates: SharedKey[];
  isPending: Mint["isPending"];
}): Promise<{ kind: "pending"; shared: SharedKey } | { kind: "none" }> {
  for (const candidate of candidates) {
    if (!isPending || (await isPending(candidate.apiKeyId))) {
      return { kind: "pending", shared: candidate };
    }
  }
  return { kind: "none" };
}

type Mint = Parameters<typeof mintShared>[0];

/** Writes the key revoked and shares it before its grants, so a retry resumes it. */
async function write({
  apiKeys,
  hold,
  input,
}: {
  apiKeys: SharedKeyWriter;
  hold: (held: SharedCredentialHold) => Promise<void>;
  input: Mint;
}): Promise<{ shared: SharedKey; key: DisabledApiKey }> {
  const expiresAt = input.newExpiresAt();
  const key = await apiKeys.writeDisabled(input.keyFor(expiresAt));
  const shared = {
    apiKeyId: key.id,
    token: key.token,
    expiresAtMs: expiresAt.epochMilliseconds,
    active: false,
    ...(input.identity === undefined ? {} : { identity: input.identity }),
  };
  await hold({
    value: JSON.stringify(shared),
    ttlMs: Math.max(1, shared.expiresAtMs - nowInstant().epochMilliseconds),
  });
  return { shared, key };
}

/** The key an earlier attempt wrote and shared, to be granted again with the same token. */
async function reopen({
  apiKeys,
  pending,
  input,
}: {
  apiKeys: SharedKeyWriter;
  pending: SharedKey;
  input: Mint;
}): Promise<{ shared: SharedKey; key: DisabledApiKey }> {
  const expiresAt = Temporal.Instant.fromEpochMilliseconds(pending.expiresAtMs);
  const key = await apiKeys.reopenDisabled({
    id: pending.apiKeyId,
    token: pending.token,
    input: input.keyFor(expiresAt),
  });
  return { shared: pending, key };
}
