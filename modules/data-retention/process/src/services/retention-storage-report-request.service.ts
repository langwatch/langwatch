/**
 * Asks for the day's retention storage measurement, one command per organization, for the
 * daily wake and the hand-run task alike. The measuring and the billing run behind the command.
 * Spec: specs/billing/retention-storage-billing.feature
 */
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { ReportRetentionStorageCommandData } from "../eventing/retention-storage-report.events.ts";
import { retentionStorageDayOf } from "../rules/retention-storage.rules.ts";
import type { RetentionStorageReportService } from "./retention-storage-report.service.ts";

const logger = createLogger("langwatch:data-retention:retention-storage");

/** What one pass asked for: organizations whose command was sent, and those that failed. */
export type RetentionStorageRequestOutcome = Readonly<{ requested: number; failed: number }>;

type Send = (data: ReportRetentionStorageCommandData) => Promise<unknown>;

type Options = Readonly<{
  organizations: Pick<RetentionStorageReportService, "findOrganizationIds">;
  now?: () => number;
}>;

export class RetentionStorageReportRequestService {
  #send: Send | undefined;

  static create(options: Options): RetentionStorageReportRequestService {
    return new RetentionStorageReportRequestService(options);
  }

  private constructor(private readonly options: Options) {}

  /** The pipeline's sender, bound once the process registered it. */
  connect(send: Send): void {
    this.#send = send;
  }

  /** One command per organization with rules; one that fails to send is counted, not fatal. */
  async requestAll({ at }: { at?: number } = {}): Promise<RetentionStorageRequestOutcome> {
    const measuredAt = at ?? this.now();
    const organizationIds = await this.options.organizations.findOrganizationIds();
    let requested = 0;
    let failed = 0;
    for (const organizationId of organizationIds) {
      try {
        await this.send({ organizationId, at: measuredAt });
        requested += 1;
      } catch (error) {
        failed += 1;
        logger.error(
          { organizationId, error: error instanceof Error ? error.message : String(error) },
          "Retention storage report could not be requested for an organization",
        );
      }
    }
    return { requested, failed };
  }

  async requestOrganization({
    organizationId,
    at,
  }: {
    organizationId: string;
    at?: number;
  }): Promise<RetentionStorageRequestOutcome> {
    await this.send({ organizationId, at: at ?? this.now() });
    return { requested: 1, failed: 0 };
  }

  private async send({
    organizationId,
    at,
  }: {
    organizationId: string;
    at: number;
  }): Promise<void> {
    if (!this.#send) throw new Error("Retention storage report used before its pipeline");
    await this.#send({
      tenantId: organizationId,
      organizationId,
      day: retentionStorageDayOf(at).day,
      occurredAt: at,
    });
  }

  private now(): number {
    return (this.options.now ?? (() => nowInstant().epochMilliseconds))();
  }
}
