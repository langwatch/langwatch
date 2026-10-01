import { nowInstant } from "@langwatch/time";

import type { CodingAgentClock } from "../app/coding-agent.members.ts";

export class SystemCodingAgentClockService implements CodingAgentClock {
  static create(): SystemCodingAgentClockService {
    return new SystemCodingAgentClockService();
  }

  private constructor() {}

  nowMs(): number {
    return nowInstant().epochMilliseconds;
  }
}
