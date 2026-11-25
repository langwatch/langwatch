import type { SystemMigration, TenantMigrationOutcome } from "@langwatch/system-migrations";
import { nowInstant } from "@langwatch/time";

import type { IdentityLatchRepository } from "../repositories/identity-latch.repository.ts";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../rules/identity-migration-names.rules.ts";
import type { IdentityBackfillService } from "./identity-backfill.service.ts";

/**
 * D01 — the identifier backfill as the runner sees it (ADR-101 §6): the
 * `SystemMigration` contract over `IdentityBackfillService`.
 * Spec: specs/identity/identifier-model.feature.
 */
export class IdentityIdentifierBackfillMigrationService implements SystemMigration {
  // Never rename: the stable state-table key. The write gate reads exactly
  // this record, so the latch and the migration share the one constant.
  readonly name = IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME;
  readonly title = "Identifier history backfill";
  readonly description =
    "Records each member's existing sign-in methods as identity history and " +
    "verifies the recorded data matches their accounts. Sign-in behavior " +
    "does not change.";
  // Dark preparation: finalization opens event EMISSION for the user; no
  // decision, no sign-in behavior and nothing customer-visible changes.
  readonly requiresOperatorConfirmation = false;
  // The release act the in-place doctrine calls for: the front door depends
  // on an identity history, so every self-hosted user gets one.
  readonly runsAutomaticallyOnSelfHosted = true;
  // Cloud startup includes every user without operator enrollment.
  readonly enrolledAutomatically = true;

  // Paced by the queue: its commands are the worker's to append, so it waits while they pile up.
  readonly pauseWhileQueuedAbove: number;

  static create({
    backfill,
    latch,
    maxQueuedJobs,
  }: {
    backfill: Pick<IdentityBackfillService, "migrateUser">;
    /** Identity's own sign-in switch: answered from, and turned on once a user is proven. */
    latch: Pick<IdentityLatchRepository, "isFinalized" | "recordProven">;
    maxQueuedJobs: number;
  }): IdentityIdentifierBackfillMigrationService {
    return new IdentityIdentifierBackfillMigrationService(backfill, latch, maxQueuedJobs);
  }

  private constructor(
    private readonly backfill: Pick<IdentityBackfillService, "migrateUser">,
    private readonly latch: Pick<IdentityLatchRepository, "isFinalized" | "recordProven">,
    maxQueuedJobs: number,
  ) {
    this.pauseWhileQueuedAbove = maxQueuedJobs;
  }

  async migrateTenant({ tenantId }: { tenantId: string }): Promise<TenantMigrationOutcome> {
    // Nothing here consults `previous`: the pass re-reads the legacy rows
    // and states only what the heads do not carry, so there is no partial
    // state a failed pass could leave behind that a full pass does not redo.
    // Already on the identifier path (an earlier pass, an older image or sign-up): done.
    if (await this.latch.isFinalized({ userId: tenantId })) {
      return { status: "finalized", report: { kind: "already_proven" } };
    }
    const outcome = await this.backfill.migrateUser({ userId: tenantId });
    if (outcome.status === "migrated") {
      // Unproven: only the person confirming the address moves it (Alex, 2026-10-06, "Adopt gap").
      return outcome.report.kind === "unproven_account"
        ? { ...outcome, heldReason: "person" }
        : outcome;
    }
    if (await this.latch.recordProven({ userId: tenantId, at: nowInstant() })) return outcome;
    // An operator pinned the user off while this pass ran; the pin wins until an operator lifts it.
    return { status: "migrated", report: { kind: "sign_in_switch_pinned" }, heldReason: "person" };
  }
}
