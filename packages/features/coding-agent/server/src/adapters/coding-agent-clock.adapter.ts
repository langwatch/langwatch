import { CodingAgentClockPort } from "../ports/coding-agent-clock.port";

export class SystemCodingAgentClock extends CodingAgentClockPort {
  static create(): SystemCodingAgentClock {
    return new SystemCodingAgentClock();
  }

  private constructor() {
    super();
  }

  nowMs(): number {
    return Date.now();
  }
}
