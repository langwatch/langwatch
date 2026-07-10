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
      sinceDay?: Date | null;
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
  /**
   * The Stripe reporter (phase 4): drains unreported hourly rows after
   * sampling, per sweep. Gated per org by release_storage_boundary_billing
   * inside the service. Optional — absent in non-SaaS presets.
   */
  reporting?: {
    reportForOrg: (params: {
      organizationId: string;
      at: Date;
    }) => Promise<void>;
  };
  /**
   * The two-layer daily audit (phase 3): runs under the day claim, after
   * the org's measurement/exits/sampling, so it checks today's settled
   * state. Optional — absent in non-SaaS presets.
   */
  audits?: {
    runScheduledAudits: (params: {
      organizationId: string;
      at: Date;
    }) => Promise<{ ran: boolean }>;
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

    const entryDay: { claimed: boolean; previousDay: Date | null } =
      await this.deps.cursor.claimEntryDay({ day: floorToDay(at) });

    const organizationIds = await this.deps.listBillableOrganizationIds();

    for (const organizationId of organizationIds) {
      try {
        if (!(await this.deps.isMeteringEnabled(organizationId))) continue;

        // Entry crossings and exits both move at day grain, so both run
        // under the day claim (exits scan the org's recorded groups — doing
        // that hourly would be 24x wasted work for values that cannot
        // change mid-day). Known blind spot: the day cursor advances before
        // the org loop, so an org failing during the day pass misses that
        // day; in-transit partitions self-heal tomorrow, and a partition on
        // its final transit day is caught by the phase-3 reference audit.
        if (entryDay.claimed) {
          await this.deps.measurement.measureEntriesForOrg({
            organizationId,
            at,
            sinceDay: entryDay.previousDay,
          });
          await this.deps.exits.emitExitsDue({ organizationId, at });
        }
        await this.deps.sampling.sampleHoursForOrg({ organizationId, at });
        if (this.deps.reporting) {
          await this.deps.reporting.reportForOrg({ organizationId, at });
        }
        if (entryDay.claimed && this.deps.audits) {
          await this.deps.audits.runScheduledAudits({ organizationId, at });
        }
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
