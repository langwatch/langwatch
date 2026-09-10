/**
 * The account's per-project NLP Lambda functions and their log groups. A port
 * rather than SDK calls in the cron route: the cutoffs are this feature's
 * decision, the account they are applied to is the deployment's.
 */

import type { Instant } from "@langwatch/time";

/** One deployed function, reduced to what the policy actually reads. */
export type NlpLambdaFunction = Readonly<{ name: string }>;

export abstract class NlpLambdaFleetRepository {
  /** Every function whose name starts with the studio's engine prefix. */
  abstract listFunctions(input: { namePrefix: string }): Promise<readonly NlpLambdaFunction[]>;

  /**
   * When the function last logged, or null when nothing says. Null is not
   * "never used": a missing log group is also unknown, and the policy declines
   * to delete on an unknown rather than guessing.
   */
  abstract tryReadLastActivityAt(input: { functionName: string }): Promise<Instant | null>;

  /** True when the function still exists in the account. */
  abstract functionExists(input: { functionName: string }): Promise<boolean>;

  abstract deleteFunction(input: { functionName: string }): Promise<void>;

  /** Every log group under the studio's engine prefix, by function name. */
  abstract listLogGroups(input: { namePrefix: string }): Promise<readonly string[]>;

  abstract deleteLogGroup(input: { functionName: string }): Promise<void>;
}
