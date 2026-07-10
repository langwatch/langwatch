import type { SchedulerHandler } from "./scheduler.types";

/**
 * ADR-042 §4 "Consumer registration": maps `targetType → handler`, the
 * calendar analog of the outbox heartbeat registry
 * (`heartbeat.registry.ts`). A report registers
 * `"reportTrigger" → renderAndDispatchReport`; adding a second scheduled
 * feature later is one row-type + one registered handler — no new loop,
 * lock, or cron parser.
 *
 * A second `register` under the same `targetType` THROWS so an accidental
 * double-registration is loud rather than silently shadowing the first.
 * Registration is passive data — safe from any process role; only
 * `SchedulerService.start()` (worker-only) acts on the registrations.
 */
export class SchedulerRegistry {
  private readonly handlers = new Map<string, SchedulerHandler>();

  register({
    targetType,
    handler,
  }: {
    targetType: string;
    handler: SchedulerHandler;
  }): void {
    if (this.handlers.has(targetType)) {
      throw new Error(
        `SchedulerRegistry: targetType "${targetType}" is already registered`,
      );
    }
    this.handlers.set(targetType, handler);
  }

  get(targetType: string): SchedulerHandler | undefined {
    return this.handlers.get(targetType);
  }

  /**
   * Drop every registration. The module singleton below outlives the App, so
   * re-initialising a worker-role App (as the integration suites do) must be
   * able to clear it — otherwise a re-registration hits the throw above.
   */
  clear(): void {
    this.handlers.clear();
  }
}

/**
 * Process-singleton registry. Consumers register against this from any
 * process role (registration is passive data); the worker-only
 * `SchedulerService` reads it on every due fire.
 */
export const schedulerRegistry = new SchedulerRegistry();
