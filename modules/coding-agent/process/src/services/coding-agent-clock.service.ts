import { nowInstant } from "@langwatch/time";

/** The package clock keeps time-dependent read and persistence rules testable. */
export interface CodingAgentClock {
  nowMs(): number;
}

export class SystemCodingAgentClockService implements CodingAgentClock {
  static create(): SystemCodingAgentClockService {
    return new SystemCodingAgentClockService();
  }

  private constructor() {}

  nowMs(): number {
    return nowInstant().epochMilliseconds;
  }
}
