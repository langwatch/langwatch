import { Temporal, type Instant } from "@langwatch/time";

export const CODING_AGENT_ACTIVITY_TOUCH_MS = 60 * 60 * 1000;

export function codingAgentActivityStaleBefore(at: Instant): Instant {
  return at.subtract(Temporal.Duration.from({ milliseconds: CODING_AGENT_ACTIVITY_TOUCH_MS }));
}
