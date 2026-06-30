import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import { createLogger } from "~/utils/logger/server";
import type { Event } from "../../domain/types";
import type { ReactorDefinition } from "../../reactors/reactor.types";

const logger = createLogger("langwatch:billing:storageMeterDispatch");

/**
 * Reactor that advances an organization's storage-billing cursor after the
 * orgBillableEventsMeter map projection succeeds (ADR-027 Phase 4).
 *
 * Deliberately thin: it resolves the org from the event's project and delegates
 * the measure → persist → enqueue work to the injected dispatch (the app-layer
 * StorageMeterDispatchService). The event is only a wake-up — what gets measured
 * is "sealed hours not yet done", computed from the wall clock and the durable
 * cursor, so the reactor needs neither the event payload nor in-memory state.
 *
 * Per-project dedup (`storage_dispatch_${projectId}`, 300s) bounds how often the
 * (idempotent) catch-up runs; `runIn: ["worker"]` keeps it off web processes and
 * grants a free cluster-wide kill switch via registration.
 */
export function createStorageMeterDispatchReactor(deps: {
  getDispatch: () => (params: { organizationId: string }) => Promise<void>;
}): ReactorDefinition<Event> {
  return {
    name: "storageMeterDispatch",
    options: {
      runIn: ["worker"],
      makeJobId: (payload) => `storage_dispatch_${payload.event.tenantId}`,
      ttl: 300_000,
    },

    async handle(_event, context) {
      const organizationId = await resolveOrganizationId(context.tenantId);
      if (!organizationId) {
        logger.warn(
          { projectId: context.tenantId },
          "orphan project detected, has no organization -- skipping storage dispatch",
        );
        return;
      }

      try {
        await deps.getDispatch()({ organizationId });
      } catch (error) {
        logger.warn(
          { organizationId, error },
          "storage meter dispatch failed; measured rows are durable, will retry on the next event",
        );
      }
    },
  };
}
