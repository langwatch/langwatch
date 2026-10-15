import { setTimeout as wait } from "node:timers/promises";

import type {
  CodingAgentSessionIndexMaterialisationRepository,
  SessionIdIndexMutation,
} from "../repositories/coding-agent-session-index-materialisation.repository.ts";

const POLL_INTERVAL_MS = 30_000;

/** What the step saves after each poll and returns when the index is materialised. */
export type SessionIdIndexProgress = Readonly<{ mutationId: string | null; partsToDo: number }>;

/**
 * Waits on goose 00110's `idx_session_id` materialisation over `coding_agent_sessions`, so its
 * progress and failure reach the upgrade ledger. Starts it once when no mutation is recorded.
 */
export class CodingAgentSessionIndexMaterialisationService {
  private constructor(
    private readonly mutations: CodingAgentSessionIndexMaterialisationRepository,
    private readonly pollIntervalMs: number,
  ) {}

  static create({
    mutations,
    pollIntervalMs = POLL_INTERVAL_MS,
  }: {
    mutations: CodingAgentSessionIndexMaterialisationRepository;
    pollIntervalMs?: number;
  }): CodingAgentSessionIndexMaterialisationService {
    return new CodingAgentSessionIndexMaterialisationService(mutations, pollIntervalMs);
  }

  async waitForSessionIdIndex({
    dryRun,
    signal,
    onPoll,
  }: {
    dryRun: boolean;
    signal: AbortSignal;
    onPoll: (progress: SessionIdIndexProgress) => Promise<void>;
  }): Promise<SessionIdIndexProgress> {
    let started = false;
    let progress: SessionIdIndexProgress = { mutationId: null, partsToDo: 0 };
    while (!signal.aborted) {
      const [latest] = await this.mutations.findSessionIdIndexMutations();
      if (!latest) {
        // Started and still unrecorded: the table has no such index, so nothing is left to build.
        if (dryRun || started) return { mutationId: null, partsToDo: 0 };
        await this.mutations.materialiseSessionIdIndex();
        started = true;
        continue;
      }
      progress = { mutationId: latest.mutationId, partsToDo: latest.partsToDo };
      if (latest.isDone) return progress;
      if (latest.latestFailReason) throw failedMaterialisation(latest);
      if (dryRun) return progress;
      await onPoll(progress);
      await wait(this.pollIntervalMs, undefined, { signal }).catch(() => undefined);
    }
    return progress;
  }
}

function failedMaterialisation(mutation: SessionIdIndexMutation): Error {
  return new Error(
    `ClickHouse could not build the coding_agent_sessions session-id index (mutation ${mutation.mutationId}, ` +
      `${mutation.partsToDo} parts left): ${mutation.latestFailReason}. ` +
      "Fix the cause on the ClickHouse server, then retry this step.",
  );
}
