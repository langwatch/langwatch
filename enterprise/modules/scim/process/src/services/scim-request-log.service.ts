// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  SCIM_REQUEST_LOG_RETENTION_MS,
  type ScimRequestLogEntry,
  type ScimRequestLogQuery,
  type ScimRequestRecord,
} from "@langwatch/enterprise-scim-contract";
import { createLogger } from "@langwatch/observability";
import type { Instant } from "@langwatch/time";

import type { ScimRepository } from "../repositories/scim.repository.ts";

const logger = createLogger("langwatch:scim:request-log");

/** The four members the evidence table needs, and nothing else. */
export type ScimRequestLogStore = Pick<
  ScimRepository,
  "recordRequest" | "findRequestLog" | "findExpiredRequestIds" | "deleteRequests"
>;

/**
 * How many expired rows one statement removes.
 *
 * Large enough that a normal sweep is one or two round trips, small enough
 * that no single delete holds locks or writes WAL for long. The sweep loops
 * until a batch comes back short, so this bounds the statement rather than
 * the work.
 */
const SWEEP_BATCH = 5_000;

/**
 * How many batches one run removes.
 *
 * A ceiling rather than "until it is empty": the sweep runs on a schedule, so
 * a backlog larger than this is finished by the next run instead of by one
 * run that holds the table for as long as the backlog is deep.
 */
const SWEEP_BATCHES = 20;

/**
 * The requests a directory made, and what we answered (ADR-126).
 *
 * WRITES NEVER FAIL A REQUEST. This records what already happened; a
 * provisioning call that worked must not be turned into a failure because the
 * evidence could not be filed, and one that was refused must keep the refusal
 * the caller was owed. So a write that throws is swallowed — and logged,
 * because a silently empty feed is exactly the symptom this table exists to
 * end.
 */
export class ScimRequestLogService {
  private constructor(private readonly store: ScimRequestLogStore) {}

  static create(store: ScimRequestLogStore): ScimRequestLogService {
    return new ScimRequestLogService(store);
  }

  async record(request: ScimRequestRecord): Promise<void> {
    try {
      await this.store.recordRequest(request);
    } catch (err) {
      logger.error(
        {
          err,
          organizationId: request.organizationId,
          connectionId: request.connectionId,
          status: request.status,
        },
        "a SCIM request could not be recorded (the request itself was answered)",
      );
    }
  }

  /**
   * Everything a connection has served, newest first.
   *
   * Bounded by a limit rather than paged, because the question it answers is
   * about the last few minutes. A reader who needs more than this is asking a
   * different question, and the answer to that one is the sync log.
   */
  findForConnection(query: ScimRequestLogQuery): Promise<ScimRequestLogEntry[]> {
    return this.store.findRequestLog(query);
  }

  /**
   * Drops what has aged out, answering how many rows went so the caller can
   * say what it did rather than assert that it ran.
   *
   * Batched, because this table takes a row per SCIM request — including every
   * read a full directory sync issues — so the backlog it clears is large and
   * lumpy. The loop stops when a batch comes back short, so a quiet table
   * costs exactly one statement.
   */
  async sweepExpired({ now }: { now: Instant }): Promise<number> {
    const before = now.subtract({ milliseconds: SCIM_REQUEST_LOG_RETENTION_MS });
    let swept = 0;

    for (let batch = 0; batch < SWEEP_BATCHES; batch++) {
      const expiring = await this.store.findExpiredRequestIds({ before, limit: SWEEP_BATCH });
      if (expiring.length === 0) break;

      swept += await this.store.deleteRequests({ ids: expiring });
      if (expiring.length < SWEEP_BATCH) break;
    }

    return swept;
  }
}
