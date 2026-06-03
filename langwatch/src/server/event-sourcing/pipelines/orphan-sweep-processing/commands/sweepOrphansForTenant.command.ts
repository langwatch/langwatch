import type { Command, CommandHandler } from "../../../";
import { defineCommandSchema } from "../../../";
import type { Event } from "../../../domain/types";
import { createLogger } from "~/utils/logger/server";
import {
  captureException,
  withScope,
} from "~/utils/posthogErrorCapture";
import type { SweepOrphansForTenantCommandData } from "../schemas/commands";
import { sweepOrphansForTenantCommandDataSchema } from "../schemas/commands";
import { ORPHAN_SWEEP_COMMAND_TYPES } from "../schemas/constants";

const logger = createLogger("langwatch:orphan-sweep:sweep-orphans-for-tenant");

/** Maximum consecutive failures before circuit-breaker trips. */
export const MAX_CONSECUTIVE_SWEEP_FAILURES = 5;

export interface SweepOrphansForTenantCommandDeps {
  loadProject: (tenantId: string) => Promise<{ archivedAt: Date | null } | null>;
  sweepProject: (params: { projectId: string }) => Promise<void>;
  selfDispatch: (data: SweepOrphansForTenantCommandData) => Promise<void>;
}

/**
 * Command handler for sweeping retention orphans for a single tenant.
 *
 * The handler:
 * 1. Circuit-breaker check: if too many consecutive failures, stop self-dispatch.
 * 2. Skip if the project is archived or hard-deleted (loop ends naturally).
 * 3. Run one bounded sweep increment; swallows transient errors and increments failure counter.
 * 4. Self-dispatches the next increment (pipeline applies the 6h delay).
 *
 * Error handling: never propagates to framework. All errors caught internally.
 * Uses constructor DI — instantiate with deps and pass via `.withCommandInstance()`.
 */
export class SweepOrphansForTenantCommand
  implements CommandHandler<Command<SweepOrphansForTenantCommandData>, Event>
{
  static readonly schema = defineCommandSchema(
    ORPHAN_SWEEP_COMMAND_TYPES.SWEEP_TENANT,
    sweepOrphansForTenantCommandDataSchema,
    "Sweep one bounded increment of a tenant's retention orphans",
  );

  constructor(private readonly deps: SweepOrphansForTenantCommandDeps) {}

  static getAggregateId(payload: SweepOrphansForTenantCommandData): string {
    return payload.tenantId;
  }

  static getSpanAttributes(
    payload: SweepOrphansForTenantCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.tenantId": payload.tenantId,
      "payload.consecutiveFailures": payload.consecutiveFailures,
    };
  }

  async handle(
    command: Command<SweepOrphansForTenantCommandData>,
  ): Promise<Event[]> {
    const { tenantId, consecutiveFailures } = command.data;

    // Circuit-breaker: stop self-dispatch after too many consecutive failures
    if (consecutiveFailures >= MAX_CONSECUTIVE_SWEEP_FAILURES) {
      logger.error(
        { tenantId, consecutiveFailures },
        "ALARM: orphan-sweep circuit-breaker tripped — consecutive failures exceeded threshold, " +
          "stopping self-dispatch. Manual investigation required.",
      );
      await withScope(async (scope) => {
        scope.setTag?.("handler", "sweepOrphansForTenant");
        scope.setExtra?.("tenantId", tenantId);
        scope.setExtra?.("consecutiveFailures", consecutiveFailures);
        captureException(new Error("orphan-sweep circuit-breaker tripped"));
      });
      return [];
    }

    const project = await this.deps.loadProject(tenantId);
    if (!project || project.archivedAt !== null) {
      logger.info(
        { tenantId },
        "loop ending — project archived or deleted",
      );
      return [];
    }

    let nextFailures = 0;
    try {
      await this.deps.sweepProject({ projectId: tenantId });
    } catch (error) {
      nextFailures = consecutiveFailures + 1;
      logger.error(
        { tenantId, consecutiveFailures: nextFailures, error },
        "orphan sweep step failed; will retry via self-dispatch",
      );
    }

    await this.deps.selfDispatch({
      tenantId,
      occurredAt: Date.now(),
      consecutiveFailures: nextFailures,
    });

    return [];
  }
}
