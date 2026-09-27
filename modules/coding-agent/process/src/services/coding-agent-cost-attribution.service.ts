import type { CodingAgentBillingPolicy } from "../app/coding-agent.members.ts";

/** Every source reads as billed, the conservative answer (main `presets.ts:2317-2320`). */
export class AllBilledCodingAgentBillingService implements CodingAgentBillingPolicy {
  static create(): AllBilledCodingAgentBillingService {
    return new AllBilledCodingAgentBillingService();
  }

  private constructor() {}

  isSourceNonBillable(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
