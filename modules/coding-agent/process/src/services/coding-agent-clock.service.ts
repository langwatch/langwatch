import { nowInstant } from "@langwatch/time";

import type { CodingAgentClock } from "../app/coding-agent.members.ts";

export class SystemCodingAgentClockAdapter implements CodingAgentClock {
  static create(): SystemCodingAgentClockAdapter {
    return new SystemCodingAgentClockAdapter();
  }

  private constructor() {}

  nowMs(): number {
    return nowInstant().epochMilliseconds;
  }
}
