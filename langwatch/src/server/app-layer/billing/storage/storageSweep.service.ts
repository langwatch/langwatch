import { createLogger } from "~/utils/logger/server";
import type { StorageSweepCursorRepository } from "./repositories/storage-sweep-cursor.repository";
import { currentSealedHour, floorToDay } from "./sealedHour";

const logger = createLogger("langwatch:billing:storageSweep");

export interface StorageSweepDeps {
  cursor: StorageSweepCursorRepository;
  /** SaaS-billable population — Stripe customer + active growth subscription. */
  listBillableOrganizationIds: () => Promise<string[]>;
  /** Per-org master gate: release_storage_boundary_metering. OFF → fully inert. */
  isMeteringEnabled: (organizationId: string) => Promise<boolean>;
  measurement: {
    measureEntriesForOrg: (params: {
      organizationId: string;
      at: Date;
    }) => Promise<void>;
  };
  exits: {
    emitExitsDue: (params: {
      organizationId: string;
      at: Date;
    }) => Promise<void>;
  };
  sampling: {
    sampleHoursForOrg: (params: {
      organizationId: string;
      at: Date;
    }) => Promise<void>;
  };
  /** Per-org failure sink (alarmed, never rethrown — no poison org). */
  onOrgFailure: (params: { organizationId: string; error: unknown }) => void;
  /** Injectable wall clock for deterministic tests. */
  now?: () => Date;
}

/**
 * The platform-wide storage sweep (ADR-039 Decision 5). Ambient ingest
 * traffic is the clock: ANY org's event wakes it, and it processes EVERY
 * billable org — an idle org's stored data keeps accruing GiB-hours, which
 * is precisely the product being billed. No cron, ever.
 *
 * The durable cursor is the once-per-hour guarantee: a redundant wake-up
 * loses the compare-and-swap claim and no-ops in O(1), across processes and
 * restarts. Entry measurement additionally claims a per-day cursor (the
 * boundary calendar is day-grained). One org's failure is alarmed and
 * skipped — it never breaks the batch.
 */
export class StorageSweepService {
  constructor(private readonly deps: StorageSweepDeps) {}

  async sweep(): Promise<void> {
    const at = (this.deps.now ?? (() => new Date()))();
    const sealedHour = currentSealedHour(at);

    const hour = await this.deps.cursor.claimHour({ sealedHour });
    if (!hour.claimed) return;

    const entryDay = await this.deps.cursor.claimEntryDay({
      day: floorToDay(at),
    });

    const organizationIds = await this.deps.listBillableOrganizationIds();

    for (const organizationId of organizationIds) {
      try {
        if (!(await this.deps.isMeteringEnabled(organizationId))) continue;

        if (entryDay.claimed) {
          await this.deps.measurement.measureEntriesForOrg({
            organizationId,
            at,
          });
        }
        await this.deps.exits.emitExitsDue({ organizationId, at });
        await this.deps.sampling.sampleHoursForOrg({ organizationId, at });
      } catch (error) {
        logger.error(
          { organizationId, error },
          "storage sweep failed for organization — skipped, other orgs unaffected; " +
            "hourly sampling self-heals on the next sweep",
        );
        this.deps.onOrgFailure({ organizationId, error });
      }
    }
  }
}
