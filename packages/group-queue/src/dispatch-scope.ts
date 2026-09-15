/** Resolves the fifth dispatch-script key without ever leaving the queue's slot. */
export function resolveDispatchAllowListRedisKey({
  keyPrefix,
  allowedGroupsKey,
}: {
  keyPrefix: string;
  allowedGroupsKey?: string;
}): string {
  return allowedGroupsKey ?? `${keyPrefix}dispatch-all`;
}
