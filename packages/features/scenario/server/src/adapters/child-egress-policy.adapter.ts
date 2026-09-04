/**
 * The outbound fence a scenario child dials an HTTP target through, carried
 * from the parent rather than read again in the child.
 *
 * A child inherits an allowlisted handful of the operator's environment on
 * purpose, and it runs under `SKIP_ENV_VALIDATION`, so a policy it resolved
 * from `process.env` itself would be the library DEFAULT rather than the
 * deployment's: an install that blocks local addresses everywhere else would
 * silently stop blocking them the moment the call moved into a child. The
 * parent resolves it once, from the same configuration leaves every other
 * outbound call in that process reads, and states it here.
 *
 * TLS is deliberately absent. `resolveChildTlsEnv` already owns that decision
 * and expresses it as the child's `NODE_TLS_REJECT_UNAUTHORIZED`; a second
 * field here would be a second answer to one question.
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
   * The parent's policy, or a throw naming the variable.
   *
   * Never a default: a missing or malformed document means the parent and the
   * child disagree about what this build forwards, and every guess available
   * here opens the fence rather than closing it. Failing the run is the one
   * outcome that cannot quietly widen egress.
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
