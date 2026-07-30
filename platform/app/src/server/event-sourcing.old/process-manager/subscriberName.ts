/**
 * The name a process manager's generated event subscriber carries.
 *
 * A process manager consumes its declaring pipeline's committed events through
 * an ordinary event subscriber that `ProcessRuntime.registerPipeline`
 * generates — the runtime has no feed or delivery mechanism of its own. The
 * prefix is what tells the two apart at the fan-out seam, where a generated
 * subscriber must NOT be treated like a hand-declared one: see
 * `ProjectionRouter.dispatchToEventSubscribers` for the kill switch that is
 * deliberately not offered here, and `ProcessManagerEnqueueOptions` for why.
 *
 * It lives in its own module so the router can ask the question without
 * importing the runtime (and its outbox workers, wake worker and store port)
 * for a string.
 *
 * RESERVED: a hand-declared subscriber must not take this prefix. Doing so
 * would silently opt it out of the kill switch every other subscriber has.
 */
export const PROCESS_MANAGER_SUBSCRIBER_PREFIX = "pm:" as const;

/** The subscriber name the runtime generates for a process manager. */
export function processManagerSubscriberName(processName: string): string {
  return `${PROCESS_MANAGER_SUBSCRIBER_PREFIX}${processName}`;
}

/** Whether a subscriber name is one the process-manager runtime generated. */
export function isProcessManagerSubscriberName(name: string): boolean {
  return name.startsWith(PROCESS_MANAGER_SUBSCRIBER_PREFIX);
}
