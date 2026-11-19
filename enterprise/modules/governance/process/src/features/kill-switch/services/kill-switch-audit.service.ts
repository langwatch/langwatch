// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { randomBytes } from "node:crypto";

import type {
  AuditLogApi,
  AuditLogIntent,
  RecordAuditLogCommand,
} from "@langwatch/audit-log-contract";
import { getEnvironment, Instance, Ksuid } from "@langwatch/ksuid";
import { nowInstant } from "@langwatch/time";

/** Where a request's audit intent waits for the worker; governance's outbox once a pipeline is built. */
export interface KillSwitchAuditOutbox {
  record(intent: AuditLogIntent): Promise<void>;
}

/** An audit row as a request writes it: dated at `occurredAt` when given, else when it is keyed. */
export type KillSwitchAuditEntry = Omit<RecordAuditLogCommand, "idempotencyKey">;

/** A fresh audit key in the second of `at`, so the row's moment and its key's agree. */
export function auditKeyAt(at: number): string {
  const random = randomBytes(12);
  return new Ksuid({
    environment: getEnvironment(),
    resource: "audit",
    timestamp: Math.floor(at / 1000),
    instance: new Instance(Instance.schemes.RANDOM, new Uint8Array(random.subarray(0, 8))),
    sequenceId: random.readUInt32BE(8) >>> 1,
  }).toString();
}

interface KillSwitchAuditDependencies {
  auditLog: Pick<AuditLogApi, "record">;
  outbox: () => KillSwitchAuditOutbox | undefined;
  newKey: (at: number) => string;
  now: () => number;
}

/**
 * The audit rows of kill switch requests and AWS connection writes. Each is keyed once, at the
 * request, and handed to the outbox, which writes it after commit and retries until it lands.
 * With no pipeline built there is no outbox, and the row is written at once under the same key.
 */
export class KillSwitchAuditService {
  private constructor(private readonly deps: KillSwitchAuditDependencies) {}

  static create({
    newKey = auditKeyAt,
    now = () => nowInstant().epochMilliseconds,
    ...deps
  }: Omit<KillSwitchAuditDependencies, "newKey" | "now"> & {
    newKey?: (at: number) => string;
    now?: () => number;
  }): KillSwitchAuditService {
    return new KillSwitchAuditService({ ...deps, newKey, now });
  }

  /** The entry keyed once and dated to the millisecond, for a repository that commits it itself. */
  intentOf(entry: KillSwitchAuditEntry): AuditLogIntent {
    const occurredAt = entry.occurredAt ?? this.deps.now();
    return { ...entry, occurredAt, idempotencyKey: this.deps.newKey(occurredAt) };
  }

  async record(entry: KillSwitchAuditEntry): Promise<void> {
    const intent = this.intentOf(entry);
    const outbox = this.deps.outbox();
    if (outbox) {
      await outbox.record(intent);
      return;
    }
    await this.deps.auditLog.record(intent);
  }
}
