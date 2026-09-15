import type { SchedulerHandler } from "./scheduler.types.ts";

/**
 * Maps targetType to handler; double-registration throws to catch shadowing.
 * Registration is passive data; only SchedulerService.start() acts on it.
 */
export class SchedulerRegistry {
  private readonly handlers = new Map<string, SchedulerHandler>();

  register({ targetType, handler }: { targetType: string; handler: SchedulerHandler }): void {
    if (this.handlers.has(targetType)) {
      throw new Error(`SchedulerRegistry: targetType "${targetType}" is already registered`);
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
