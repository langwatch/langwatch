/**
 * Meters hosted judgements as one spend row per key per window rather than one
 * per judged text, so a run of ten thousand costs ten thousand calls and one
 * write. The bounded loss on a dying process is stated in ADR-156 §5.
 */

import { nowInstant, type Instant } from "@langwatch/time";

import type { HostedSpendRecorder, LicenseLogger } from "../app/licensing.members.ts";

export interface ConnectSpendEntry {
  virtualKeyId: string;
  projectId: string;
  inputTokens: number;
  costUsd: number;
  priceUsd: number;
}

interface Pending extends ConnectSpendEntry {
  requests: number;
}

export interface ConnectSpendBufferCollaborators {
  recorder: HostedSpendRecorder;
  logger?: LicenseLogger;
  /** How long spend waits before it is written. */
  flushIntervalMs?: number;
  /** Calls under one key that force a write before the interval is up. */
  maxRequestsPerKey?: number;
  now?: () => Instant;
}

const DEFAULT_FLUSH_INTERVAL_MS = 5_000;
const DEFAULT_MAX_REQUESTS_PER_KEY = 500;

export class ConnectSpendBufferService {
  static create(collaborators: ConnectSpendBufferCollaborators): ConnectSpendBufferService {
    return new ConnectSpendBufferService(collaborators);
  }

  readonly #pending = new Map<string, Pending>();
  readonly #flushIntervalMs: number;
  readonly #maxRequestsPerKey: number;
  readonly #now: () => Instant;
  #timer: ReturnType<typeof setTimeout> | undefined;

  private constructor(private readonly collaborators: ConnectSpendBufferCollaborators) {
    this.#flushIntervalMs = collaborators.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.#maxRequestsPerKey = collaborators.maxRequestsPerKey ?? DEFAULT_MAX_REQUESTS_PER_KEY;
    this.#now = collaborators.now ?? nowInstant;
  }

  add(entry: ConnectSpendEntry): void {
    if (entry.inputTokens <= 0) return;
    const merged = this.#merge(entry, 1);
    if (merged.requests >= this.#maxRequestsPerKey) {
      void this.flush();
      return;
    }
    this.#armTimer();
  }

  /** Writes everything pending. Safe to call at any time, and on shutdown. */
  async flush(): Promise<void> {
    this.#disarmTimer();
    const batch = [...this.#pending.values()];
    this.#pending.clear();
    await Promise.all(batch.map((record) => this.#write(record)));
  }

  async #write(record: Pending): Promise<void> {
    try {
      await this.collaborators.recorder.recordSpend({
        projectId: record.projectId,
        virtualKeyId: record.virtualKeyId,
        inputTokens: record.inputTokens,
        requests: record.requests,
        costUsd: record.costUsd,
        priceUsd: record.priceUsd,
        occurredAt: this.#now(),
      });
    } catch (error) {
      // Kept for the next write rather than dropped: usage that was served and
      // not metered is revenue lost without a trace.
      this.collaborators.logger?.error(
        { virtualKeyId: record.virtualKeyId, error },
        "Hosted spend could not be recorded, keeping it for the next write",
      );
      this.#merge(record, record.requests);
      this.#armTimer();
    }
  }

  #merge(entry: ConnectSpendEntry, requests: number): Pending {
    const key = `${entry.virtualKeyId}/${entry.projectId}`;
    const current = this.#pending.get(key);
    const merged: Pending = {
      virtualKeyId: entry.virtualKeyId,
      projectId: entry.projectId,
      inputTokens: (current?.inputTokens ?? 0) + entry.inputTokens,
      costUsd: (current?.costUsd ?? 0) + entry.costUsd,
      priceUsd: (current?.priceUsd ?? 0) + entry.priceUsd,
      requests: (current?.requests ?? 0) + requests,
    };
    this.#pending.set(key, merged);
    return merged;
  }

  #armTimer(): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.flush();
    }, this.#flushIntervalMs);
    // The process may exit with spend pending only through `flush`, which the
    // shutdown sequence calls. The timer itself must not keep it alive.
    this.#timer.unref?.();
  }

  #disarmTimer(): void {
    if (!this.#timer) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
