import { CodingAgentClockPort } from "../ports/coding-agent-clock.port.ts";
import { nowInstant } from "@langwatch/time";

export class SystemCodingAgentClockAdapter extends CodingAgentClockPort {
  static create(): SystemCodingAgentClockAdapter {
    return new SystemCodingAgentClockAdapter();
  }

  private constructor() {
    super();
  }

  nowMs(): number {
    return nowInstant().epochMilliseconds;
  }
}
