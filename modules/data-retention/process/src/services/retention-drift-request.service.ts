/**
 * Asks for the drift check, one command per organization with rules, for the daily wake and the
 * hand-run task alike. The check itself runs behind the command.
 * Spec: modules/data-retention/specs/retention-drift-check.feature
 */
import { createLogger, type Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { CheckRetentionDriftCommandData } from "../eventing/retention-drift.events.ts";
import type { DataRetentionRepository } from "../repositories/data-retention.repository.ts";

/** What one sweep asked for: organizations whose check was sent, and those that failed. */
export type RetentionDriftRequestOutcome = Readonly<{ requested: number; failed: number }>;

type Send = (data: CheckRetentionDriftCommandData) => Promise<unknown>;

type Options = Readonly<{
  policies: Pick<DataRetentionRepository, "findOrganizationIdsWithRules">;
  logger?: Logger;
  now?: () => number;
}>;

export class RetentionDriftRequestService {
  #send: Send | undefined;
  private readonly logger: Logger;

  static create(options: Options): RetentionDriftRequestService {
    return new RetentionDriftRequestService(options);
  }

  private constructor(private readonly options: Options) {
    this.logger = options.logger ?? createLogger("langwatch:data-retention:retention-drift");
  }

  /** The pipeline's sender, bound once the process registered it. */
  connect(send: Send): void {
    this.#send = send;
  }

  /** One check per organization with rules; one that fails to send is counted, not fatal. */
  async requestAll({ at }: { at?: number } = {}): Promise<RetentionDriftRequestOutcome> {
    const checkedAt = at ?? this.now();
    const organizationIds = await this.options.policies.findOrganizationIdsWithRules();
    let requested = 0;
    let failed = 0;
    for (const organizationId of organizationIds) {
      try {
        await this.send({ tenantId: organizationId, organizationId, occurredAt: checkedAt });
        requested += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(
          { organizationId, error: error instanceof Error ? error.message : String(error) },
          "Retention drift check could not be requested for an organization",
        );
      }
    }
    return { requested, failed };
  }

  async requestOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<RetentionDriftRequestOutcome> {
    await this.send({ tenantId: organizationId, organizationId, occurredAt: this.now() });
    return { requested: 1, failed: 0 };
  }

  private async send(data: CheckRetentionDriftCommandData): Promise<void> {
    if (!this.#send) throw new Error("Retention drift check used before its pipeline");
    await this.#send(data);
  }

  private now(): number {
    return (this.options.now ?? (() => nowInstant().epochMilliseconds))();
  }
}
