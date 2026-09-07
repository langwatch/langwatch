import type { Instant } from "@langwatch/time";

export abstract class AutomationClockPort {
  abstract now(): Instant;
}
