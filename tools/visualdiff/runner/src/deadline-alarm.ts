import { note } from "./protocol.ts";

/** DEADLINE_ALARM_ROUTES is how many of a side's first routes decide whether settling is broken. */
export const DEADLINE_ALARM_ROUTES = 5;

/** SettleResult is the part of a settle outcome the alarm reads. */
export interface SettleResult {
  expired: boolean;
  inFlight: string[];
}

/**
 * DeadlineAlarm warns once, loudly, when every one of a side's first routes
 * ran to the settle deadline: that is a settle bug costing the whole run, not
 * a slow screen.
 */
export class DeadlineAlarm {
  private seen = 0;
  private expired = 0;

  constructor(
    private readonly side: string,
    private readonly warn: (text: string) => void = (text) => note({ text, err: process.stderr }),
  ) {}

  record(outcome: SettleResult): void {
    this.seen += 1;
    if (outcome.expired) this.expired += 1;
    if (this.seen !== DEADLINE_ALARM_ROUTES || this.expired !== DEADLINE_ALARM_ROUTES) return;
    this.warn(
      `WARNING: every one of ${this.side}'s first ${DEADLINE_ALARM_ROUTES} routes hit the settle deadline; ` +
        `the settle is waiting on something that never finishes (last still in flight: ${outcome.inFlight.join(", ") || "none"})`,
    );
  }
}
