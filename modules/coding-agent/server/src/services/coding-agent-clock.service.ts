import { CodingAgentClock } from "../app/coding-agent.infrastructure.ts";
import { nowInstant } from "@langwatch/time";

export class SystemCodingAgentClockAdapter implements CodingAgentClock {
  static create(): SystemCodingAgentClockAdapter {
    return new SystemCodingAgentClockAdapter();
  }

  private constructor() {
  }

  nowMs(): number {
    return nowInstant().epochMilliseconds;
  }
}
