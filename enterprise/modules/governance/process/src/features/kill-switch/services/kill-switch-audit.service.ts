// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AuditLogApi, AuditLogEntry, AuditLogIntent } from "@langwatch/audit-log-contract";
import { generate } from "@langwatch/ksuid";

/** Where a request's audit intent waits for the worker; governance's outbox once a pipeline is built. */
export interface KillSwitchAuditOutbox {
  record(intent: AuditLogIntent): Promise<void>;
}

interface KillSwitchAuditDependencies {
  auditLog: Pick<AuditLogApi, "record">;
  outbox: () => KillSwitchAuditOutbox | undefined;
  newKey: () => string;
}

/**
 * The audit rows of kill switch requests and AWS connection writes. Each is keyed once, at the
 * request, and handed to the outbox, which writes it after commit and retries until it lands.
 * With no pipeline built there is no outbox, and the row is written at once under the same key.
 */
export class KillSwitchAuditService {
  private constructor(private readonly deps: KillSwitchAuditDependencies) {}

  static create({
    newKey = () => generate("audit").toString(),
    ...deps
  }: Omit<KillSwitchAuditDependencies, "newKey"> & {
    newKey?: () => string;
  }): KillSwitchAuditService {
    return new KillSwitchAuditService({ ...deps, newKey });
  }

  async record(entry: AuditLogEntry): Promise<void> {
    const intent: AuditLogIntent = { ...entry, idempotencyKey: this.deps.newKey() };
    const outbox = this.deps.outbox();
    if (outbox) {
      await outbox.record(intent);
      return;
    }
    await this.deps.auditLog.record(intent);
  }
}
