/**
 * Honest doubles for the members a process hands its modules.
 *
 * Each is a VALUE a caller passes - `createApp({ members: { clock: frozenAt(…) } })`
 * - and never a second builder. There is no `createTestInfrastructure`, because
 * a test that assembles its own pool assembles a pool production does not have,
 * and the two drift apart in exactly the places nobody looks.
 *
 * The member shapes are described here rather than imported, the way
 * `test-audit-sink.ts` describes the audit row: the harness is a
 * dependency of nearly every package, and a dependency on the package that
 * opens Postgres, ClickHouse, Redis and S3 would put that graph on the boot
 * path of every suite that only wanted a lane. Structural typing still checks
 * these against the real members where they are handed in.
 */

/** Now, as a module reads it. */
export interface Clock {
  now(): Date;
}

/** A clock a test moves. It never advances on its own. */
export interface FrozenClock extends Clock {
  advance(milliseconds: number): void;
  set(moment: Date | string): void;
}

/**
 * A clock stopped at one moment, so a test that asserts on a timestamp asserts
 * on the timestamp rather than on how long the suite took to get there.
 */
export function frozenAt(moment: Date | string = "2026-01-01T00:00:00.000Z"): FrozenClock {
  let now = typeof moment === "string" ? new Date(moment) : moment;
  return {
    now: () => new Date(now),
    advance: (milliseconds) => void (now = new Date(now.getTime() + milliseconds)),
    set: (next) => void (now = typeof next === "string" ? new Date(next) : next),
  };
}

/** Response bodies, keyed and tagged, as the cache member holds them. */
export interface Cache {
  find(key: string): Promise<Uint8Array | undefined>;
  set(key: string, tag: string, body: Uint8Array, ttlSeconds: number): Promise<void>;
  invalidateTag(tag: string): Promise<void>;
}

/** Cached bodies in a Map, with the tag semantics Redis gives. */
export function memoryCache(): Cache {
  const entries = new Map<string, Uint8Array>();
  const tagged = new Map<string, Set<string>>();
  return {
    find: (key) => Promise.resolve(entries.get(key)),
    set(key, tag, body) {
      entries.set(key, body);
      const keys = tagged.get(tag) ?? new Set<string>();
      keys.add(key);
      tagged.set(tag, keys);
      return Promise.resolve();
    },
    invalidateTag(tag) {
      for (const key of tagged.get(tag) ?? []) entries.delete(key);
      tagged.delete(tag);
      return Promise.resolve();
    },
  };
}

/** Remembers a key for the window in which a repeat must not act twice. */
export interface IdempotencyStore {
  claim(key: string, ttlSeconds: number): Promise<boolean>;
}

/** Claims a key once, for as long as the test lives. */
export function memoryIdempotency(): IdempotencyStore {
  const claimed = new Set<string>();
  return {
    claim(key) {
      if (claimed.has(key)) return Promise.resolve(false);
      claimed.add(key);
      return Promise.resolve(true);
    },
  };
}

/** What one rate-limit decision says. */
export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number;
}

export interface RateLimiter {
  check(key: string): Promise<RateLimitDecision>;
}

/** Counts every key and refuses past the allowance, with no window. */
export function memoryRateLimiter(allowance = Number.MAX_SAFE_INTEGER): RateLimiter {
  const used = new Map<string, number>();
  return {
    check(key) {
      const count = (used.get(key) ?? 0) + 1;
      used.set(key, count);
      if (count <= allowance) return Promise.resolve({ allowed: true });
      return Promise.resolve({ allowed: false, retryAfterSeconds: 1 });
    },
  };
}

/** One stored object, and the project whose object it is. */
export interface StoredObject {
  readonly body: Uint8Array;
  readonly contentType: string | undefined;
}

export interface StoredObjectAddress {
  readonly projectId: string;
  readonly key: string;
}

export interface ObjectStorage {
  put(at: StoredObjectAddress, body: Uint8Array, contentType?: string): Promise<void>;
  find(at: StoredObjectAddress): Promise<StoredObject | undefined>;
  remove(at: StoredObjectAddress): Promise<void>;
}

/**
 * Blobs in a Map, keyed by project and key together - so a test that reads one
 * project's object back under another project's id fails here as it would
 * against the real member, which routes on the project and cannot be handed an
 * unscoped client at all.
 */
export function memoryObjectStorage(): ObjectStorage {
  const stored = new Map<string, StoredObject>();
  const at = (address: StoredObjectAddress) => `${address.projectId}/${address.key}`;
  return {
    put(address, body, contentType) {
      stored.set(at(address), { body, contentType });
      return Promise.resolve();
    },
    find: (address) => Promise.resolve(stored.get(at(address))),
    remove(address) {
      stored.delete(at(address));
      return Promise.resolve();
    },
  };
}

/** One message, already rendered, as the mail member sends it. */
export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly from?: string;
}

export interface Mail {
  send(message: MailMessage): Promise<void>;
}

/** Mail a test reads back, rather than a provider a test cannot see. */
export interface RecordingMail extends Mail {
  readonly sent: readonly MailMessage[];
}

export function recordingMail(): RecordingMail {
  const sent: MailMessage[] = [];
  return {
    sent,
    send(message) {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

/** Counters and observations a module reports without naming an exporter. */
export interface Telemetry {
  count(name: string, value?: number, attributes?: Readonly<Record<string, string>>): void;
  observe(name: string, value: number, attributes?: Readonly<Record<string, string>>): void;
}

/** One recorded counter or observation. */
export interface RecordedMetric {
  readonly name: string;
  readonly value: number;
  readonly attributes: Readonly<Record<string, string>> | undefined;
}

export interface RecordingTelemetry extends Telemetry {
  readonly counts: readonly RecordedMetric[];
  readonly observations: readonly RecordedMetric[];
}

export function recordingTelemetry(): RecordingTelemetry {
  const counts: RecordedMetric[] = [];
  const observations: RecordedMetric[] = [];
  return {
    counts,
    observations,
    count: (name, value = 1, attributes) => void counts.push({ name, value, attributes }),
    observe: (name, value, attributes) => void observations.push({ name, value, attributes }),
  };
}
