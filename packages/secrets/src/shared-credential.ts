import { nowInstant, type Instant } from "@langwatch/time";

/**
 * Mint once, share sealed (ARCHITECTURE.md §7): the one way every server shares a credential it
 * minted. One caller claims the address and mints; the rest wait for its value. The live store is
 * `RedisSharedCredentialStore` (`@langwatch/redis-client/shared-credential`), sealed at rest.
 */

/** Where one shared credential lives: always under its tenant, one of several there by content. */
export type SharedCredentialAddress = Readonly<{ tenantId: string; contentKey?: string }>;

/** What seals a held value at rest: the stores' `encryption` client, a registry input. */
export type SharedCredentialCipher = Readonly<{
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}>;

/** A won claim on an address; only its holder releases it. */
export type SharedCredentialClaim = Readonly<{ token: string }>;

/** A value to hold and how long it stays shared; never longer than the credential lives. */
export type SharedCredentialHold = Readonly<{ value: string; ttlMs: number }>;

/** The record's one wait for a request on another's write: 10 s, then pending (§9). */
const WAIT_MS = 10_000;
/** Longer than any mint runs: a write, a grant, and that grant's 10 s wait. */
const CLAIM_MS = 30_000;
const POLL_MS = 200;

/** The held value is there but cannot be opened: the cipher changed, or the value was damaged. */
export class SharedCredentialUnreadableError extends Error {
  override readonly name = "SharedCredentialUnreadableError";

  constructor(options: { cause: unknown }) {
    super("A shared credential cannot be read back", { cause: options.cause });
  }
}

/** Another caller holds the claim and nothing usable was shared within the wait. */
export class SharedCredentialPendingError extends Error {
  override readonly name = "SharedCredentialPendingError";

  constructor() {
    super("Another server is still minting this credential");
  }
}

/** The store a module's repository is: built in its registry, never seen by a service as Redis. */
export abstract class SharedCredentialStore {
  /** The held value, or none; {@link SharedCredentialUnreadableError} when it cannot be opened. */
  abstract find(address: SharedCredentialAddress): Promise<string[]>;
  /** Takes the address for `ttlMs` when nobody holds it: the won claim, or none. */
  abstract claim(input: {
    address: SharedCredentialAddress;
    ttlMs: number;
  }): Promise<SharedCredentialClaim[]>;
  /** Holds the value for `ttlMs`, replacing whatever the address held. */
  abstract hold(input: { address: SharedCredentialAddress } & SharedCredentialHold): Promise<void>;
  /** Drops a claim this caller still holds; a claim another caller took since stays. */
  abstract release(input: {
    address: SharedCredentialAddress;
    claim: SharedCredentialClaim;
  }): Promise<void>;
  /** Drops the held value, so the next caller mints: the hook for a revoked credential. */
  abstract forget(address: SharedCredentialAddress): Promise<void>;
}

/** The one key layout, `<prefix><tenantId>[:<contentKey>]`: no value is shared across tenants. */
export function sharedCredentialKey({
  prefix,
  address,
}: {
  prefix: string;
  address: SharedCredentialAddress;
}): string {
  const { tenantId, contentKey } = address;
  return contentKey === undefined ? `${prefix}${tenantId}` : `${prefix}${tenantId}:${contentKey}`;
}

type Mint = (input: {
  earlier: string[];
  hold: (held: SharedCredentialHold) => Promise<void>;
}) => Promise<SharedCredentialHold>;

type MintOnceInput = {
  store: SharedCredentialStore;
  address: SharedCredentialAddress;
  /** How long a claimant may take before another may claim: longer than any mint runs. */
  claimMs?: number;
  /** How long a caller waits on another's mint before {@link SharedCredentialPendingError}. */
  waitMs?: number;
  pollMs?: number;
  isReady?: (value: string) => boolean;
  onUnreadable?: (error: SharedCredentialUnreadableError) => void;
  mint: Mint;
};

/**
 * The shared value at `address`, minted by exactly one caller across every server. A value
 * `isReady` refuses (spent, or left half-done) goes to the next claimant's `mint` as `earlier`;
 * `hold` there shares a half-done value before the slow step, so a retry resumes it.
 */
export async function mintOnce(input: MintOnceInput): Promise<string> {
  const { waitMs = WAIT_MS, pollMs = POLL_MS } = input;
  const deadline = nowInstant().epochMilliseconds + waitMs;
  const read = readOnce(input);

  for (let first = true; ; first = false) {
    const [ready] = (await read()).filter(input.isReady ?? always);
    if (ready !== undefined) return ready;
    if (!first && nowInstant().epochMilliseconds >= deadline) {
      throw new SharedCredentialPendingError();
    }
    const [minted] = await mintIfClaimed({ ...input, read });
    if (minted !== undefined) return minted;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

function always(): boolean {
  return true;
}

/** Reads the held value; an unreadable one reads as none, reported once per call. */
function readOnce({ store, address, onUnreadable }: MintOnceInput): () => Promise<string[]> {
  let told = false;
  return async () => {
    try {
      return await store.find(address);
    } catch (error) {
      if (!(error instanceof SharedCredentialUnreadableError)) throw error;
      if (!told) onUnreadable?.(error);
      told = true;
      return [];
    }
  };
}

/** Mints under a won claim and shares the result; none when another caller holds the claim. */
async function mintIfClaimed({
  store,
  address,
  claimMs = CLAIM_MS,
  isReady = always,
  mint,
  read,
}: MintOnceInput & { read: () => Promise<string[]> }): Promise<string[]> {
  const [claim] = await store.claim({ address, ttlMs: claimMs });
  if (!claim) return [];
  try {
    // Read again under the claim: an earlier claimant may have finished since.
    const earlier = await read();
    const finished = earlier.filter(isReady);
    if (finished.length > 0) return finished;
    const hold = (held: SharedCredentialHold) => store.hold({ address, ...held });
    const minted = await mint({ earlier, hold });
    await hold(minted);
    return [minted.value];
  } finally {
    await store.release({ address, claim });
  }
}

/** One process's shared values, in plaintext as memory twins hold; expiry follows `now`. */
export class MemorySharedCredentialStore extends SharedCredentialStore {
  readonly #held = new Map<string, { value: string; until: number }>();
  readonly #claims = new Map<string, { token: string; until: number }>();

  private constructor(private readonly now: () => Instant) {
    super();
  }

  static create(options: { now?: () => Instant } = {}): MemorySharedCredentialStore {
    return new MemorySharedCredentialStore(options.now ?? nowInstant);
  }

  find(address: SharedCredentialAddress): Promise<string[]> {
    const held = this.#live(this.#held, sharedCredentialKey({ prefix: "", address }));
    return Promise.resolve(held ? [held.value] : []);
  }

  claim({
    address,
    ttlMs,
  }: {
    address: SharedCredentialAddress;
    ttlMs: number;
  }): Promise<SharedCredentialClaim[]> {
    const key = sharedCredentialKey({ prefix: "", address });
    if (this.#live(this.#claims, key)) return Promise.resolve([]);
    const token = globalThis.crypto.randomUUID();
    this.#claims.set(key, { token, until: this.#nowMs() + ttlMs });
    return Promise.resolve([{ token }]);
  }

  hold({
    address,
    value,
    ttlMs,
  }: { address: SharedCredentialAddress } & SharedCredentialHold): Promise<void> {
    const key = sharedCredentialKey({ prefix: "", address });
    this.#held.set(key, { value, until: this.#nowMs() + ttlMs });
    return Promise.resolve();
  }

  release({
    address,
    claim,
  }: {
    address: SharedCredentialAddress;
    claim: SharedCredentialClaim;
  }): Promise<void> {
    const key = sharedCredentialKey({ prefix: "", address });
    if (this.#claims.get(key)?.token === claim.token) this.#claims.delete(key);
    return Promise.resolve();
  }

  forget(address: SharedCredentialAddress): Promise<void> {
    this.#held.delete(sharedCredentialKey({ prefix: "", address }));
    return Promise.resolve();
  }

  #live<T extends { until: number }>(entries: Map<string, T>, key: string): T | undefined {
    const entry = entries.get(key);
    if (entry && entry.until > this.#nowMs()) return entry;
    entries.delete(key);
    return undefined;
  }

  #nowMs(): number {
    return this.now().epochMilliseconds;
  }
}
