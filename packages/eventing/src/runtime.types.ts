/** Deployment-defined label used to select where a subscriber runs. */
export type ExecutionTarget = string;

/** A resolved data-retention policy is opaque to the framework and interpreted
 * by projection stores. */
export type RetentionPolicy = Readonly<Record<string, number>>;

export interface RetentionPolicyResolver {
  resolve(tenantId: string): Promise<RetentionPolicy | null>;
}

export function executionTargetMatches(
  allowed: readonly ExecutionTarget[] | undefined,
  current: ExecutionTarget | undefined,
): boolean {
  if (!allowed || !current) return true;
  return allowed.includes(current);
}
