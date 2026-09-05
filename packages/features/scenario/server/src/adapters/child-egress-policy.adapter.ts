/**
 * The outbound fence a scenario child dials an HTTP target through, carried from the parent rather
 * than read again in the child.
 */

import { z } from "zod";

export const SCENARIO_EGRESS_POLICY_ENV = "LANGWATCH_SCENARIO_EGRESS_POLICY";

const scenarioEgressPolicySchema = z.object({
  /** Refuse private and loopback destinations, as the deployment configured it. */
  blockLocal: z.boolean(),
  /** Literal hostnames exempt from that refusal. Cloud metadata is never exempt. */
  allowedHosts: z.array(z.string()),
});

export type ScenarioEgressPolicy = z.infer<typeof scenarioEgressPolicySchema>;

export class ChildEgressPolicyAdapter {
  static create(): ChildEgressPolicyAdapter {
    return new ChildEgressPolicyAdapter();
  }

  private constructor() {}

  static encode(policy: ScenarioEgressPolicy): string {
    return JSON.stringify(scenarioEgressPolicySchema.parse(policy));
  }

  /**
   * The parent's policy, or a throw naming the variable. Never a default: a missing or malformed
   * document means the parent and the child disagree about what this build forwards, and every
   * guess available here opens the fence rather than closing it.
   */
  static decode(raw: string | undefined): ScenarioEgressPolicy {
    if (!raw) {
      throw new Error(
        `${SCENARIO_EGRESS_POLICY_ENV} is not set: the parent process must state the egress policy a scenario child dials an HTTP target with.`,
      );
    }
    return scenarioEgressPolicySchema.parse(JSON.parse(raw));
  }
}

export const encodeScenarioEgressPolicy = ChildEgressPolicyAdapter.encode;
export const decodeScenarioEgressPolicy = ChildEgressPolicyAdapter.decode;
