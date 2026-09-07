/**
 * The operator's rollback: pinning a migrated or finalized organization back onto its legacy path,
 * then applying whatever that migration's own rollback has to undo. The pin is written first and
 * carries the decision stamp, so a retry after a failed effect does not decide twice.
 */

import { createLogger } from "@langwatch/observability";
import type { TenantMigrationRecord } from "@langwatch/system-migrations";
import {
  ROLLBACK_EFFECT_STATUSES,
  type SystemMigrationsServiceDependencies,
} from "../rules/system-migration-support.rules.ts";
import { systemMigrationLookup } from "./system-migration-lookup.service.ts";
import { nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:ops:system-migrations");

export class SystemMigrationRollbackService {
  static create(deps: SystemMigrationsServiceDependencies): SystemMigrationRollbackService {
    return new SystemMigrationRollbackService(deps);
  }

  private constructor(private readonly deps: SystemMigrationsServiceDependencies) {}

  /**
   * The operator's rollback: pin a migrated or finalized organization back onto its legacy path
   * (specs/migration/system-migrations-runner.feature, "An operator rolls a finalized organization back to its legacy path", "An
   * operator rolls a migrated organization back to its legacy path"), then apply whatever that migration's rollback has to DO.
   */
  async rollBack({
    migrationName,
    tenantId,
    actorUserId,
  }: {
    migrationName: string;
    tenantId: string;
    actorUserId: string;
  }): Promise<void> {
    systemMigrationLookup.registeredMigration(this.deps, migrationName);
    const record = await this.deps.state.tryFindRecord({
      migrationName,
      tenantId,
    });
    // The migration's own preconditions, before anything is written: a
    // refusal here leaves no pin behind, so the tenant's state is exactly
    // what it was when the operator asked.
    await this.deps.rollbackGuards?.[migrationName]?.({ tenantId, record });
    const priorReport =
      record?.report != null && typeof record.report === "object"
        ? (record.report as Record<string, unknown>)
        : {};
    // A fresh decision for an organization still on the ledger, the recorded one
    // for a retry. The status is what distinguishes them: a migrated or finalized
    // record that still carries a stamp from an earlier rollback has since been
    // cut over again, and rolling it back now is a NEW decision that must not
    // reuse the old moment (and so must not dedupe against the old event).
    const isRetry = record?.status === "rolled_back";
    const decidedAt =
      (isRetry ? rollbackDecidedAt(priorReport) : null) ??
      nowInstant().toString({ fractionalSecondDigits: 3 });
    const pin = {
      migrationName,
      tenantId,
      status: "rolled_back" as const,
      report: {
        ...priorReport,
        rolledBack: { by: actorUserId, at: decidedAt },
      },
    };

    // The pin FIRST, its effects after — deliberately in that order. The stored `rolled_back`
    // status is what stops the next pass re-finalizing the tenant, so it must land even if the
    // effect cannot. An effect that throws therefore leaves the pin standing and propagates to
    // the operator, who sees a rollback that was recorded but not fully applied and can retry
    // it; the reverse order could leave a tenant the runner re-finalizes minutes later.
    await this.writePin({ pin, record, isRetry, priorReport, actorUserId });

    // Only for a status that could have reached the ledger. A `parked`
    // organization and one with no record never cut over, so there is
    // nothing for an effect to undo and no defined meaning for running one.
    if (record === null || !ROLLBACK_EFFECT_STATUSES.includes(record.status)) {
      return;
    }

    await this.deps.rollbackEffects?.[migrationName]?.({
      tenantId,
      actorUserId,
      decidedAt,
    });
  }

  /**
   * The `rolled_back` pin, written unless a retry already carries it.
   */
  private async writePin({
    pin,
    record,
    isRetry,
    priorReport,
    actorUserId,
  }: {
    pin: TenantMigrationRecord;
    record: TenantMigrationRecord | null;
    isRetry: boolean;
    priorReport: Record<string, unknown>;
    actorUserId: string;
  }): Promise<void> {
    if (isRetry) {
      if (rollbackDecidedAt(priorReport) === null) {
        await this.deps.state.upsertRecord(pin);
      }

      logger.warn(
        {
          migrationName: pin.migrationName,
          tenantId: pin.tenantId,
          actorUserId,
        },
        "operator retried the rollback of an already pinned tenant",
      );

      return;
    }

    await this.deps.state.upsertRecord(pin);
    logger.warn(
      {
        migrationName: pin.migrationName,
        tenantId: pin.tenantId,
        actorUserId,
        // Null when nothing had run for this organization yet: the operator is
        // holding it OUT of a rollout rather than pulling it back from one,
        // and the trail must not read as the latter.
        priorStatus: record?.status ?? null,
      },
      "operator pinned a tenant onto its legacy path; later passes leave it alone",
    );
  }
}

/**
 * When this rollback was decided, read back off the pin a previous call wrote. Null when the report carries no
 * usable stamp — a record pinned by something other than this method, or by a version of it that predates the
 * stamp — in which case the caller falls back to now and the retry simply does not dedupe.
 */
function rollbackDecidedAt(report: Record<string, unknown>): string | null {
  const rolledBack = report.rolledBack;
  if (rolledBack == null || typeof rolledBack !== "object") {
    return null;
  }

  const at = (rolledBack as Record<string, unknown>).at;

  return typeof at === "string" && at !== "" ? at : null;
}
