import type { EventingCommandSender } from "@langwatch/eventing";
import type { LimitType } from "@langwatch/organization-contract";
import { nowInstant } from "@langwatch/time";

import type { OrganizationSignals } from "../app/organization.members.ts";
import type { RecordSeatLimitReachedCommandData } from "../eventing/seat-limit.events.ts";

export type SeatLimitReached = Readonly<{
  organizationId: string;
  limitType: LimitType;
  current: number;
  max: number;
}>;

type SeatLimitReachedSender = Pick<
  EventingCommandSender<RecordSeatLimitReachedCommandData>,
  "send"
>;

/**
 * Where a reached seat limit is recorded as organization's event, which the worker hands to
 * billing's ops alert (§9). The sender arrives once the pipeline registers, after construction.
 */
export class SeatLimitNoticeService {
  static create(dependencies: {
    signals: Pick<OrganizationSignals, "reportError">;
  }): SeatLimitNoticeService {
    return new SeatLimitNoticeService(dependencies);
  }

  #sender: SeatLimitReachedSender | undefined;

  private constructor(
    private readonly dependencies: { signals: Pick<OrganizationSignals, "reportError"> },
  ) {}

  connect(sender: SeatLimitReachedSender): void {
    this.#sender = sender;
  }

  async record(input: SeatLimitReached): Promise<void> {
    const sender = this.#sender;
    if (!sender) throw new Error("organization_seat_limit is not registered in this process");
    await sender.send({
      ...input,
      tenantId: input.organizationId,
      occurredAt: nowInstant().epochMilliseconds,
    });
  }

  /** Fire-and-forget beside a refusal: a notice that fails is reported, never thrown. */
  reached(input: SeatLimitReached): void {
    void this.record(input).catch((failure: unknown) =>
      this.dependencies.signals.reportError(failure),
    );
  }
}
