export function uniqueConstraintTargets(error: unknown): unknown {
  return (error as { meta?: { target?: unknown } })?.meta?.target;
}
