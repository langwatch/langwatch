import { CodingAgentClockPort } from "../ports/coding-agent-clock.port";

export class SystemCodingAgentClockAdapter extends CodingAgentClockPort {
  static create(): SystemCodingAgentClockAdapter {
    return new SystemCodingAgentClockAdapter();
  }

  private constructor() {
    super();
  }

  nowMs(): number {
    return Date.now();
  }
}
