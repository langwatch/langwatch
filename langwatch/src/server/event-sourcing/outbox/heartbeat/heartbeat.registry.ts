import type { HeartbeatDefinition } from "./heartbeat.types";

/**
 * Process-singleton registry of outbox heartbeats. A second `register(...)`
 * under the same name THROWS, so an accidental double-registration is loud
 * rather than silently shadowing the first definition.
 *
 * Registration is passive data — safe to call from any process role.
 * Only `OutboxHeartbeatScheduler.start()` (worker-only) actually does
 * anything with the registered definitions.
 */
export class OutboxHeartbeatRegistry {
  private readonly heartbeats = new Map<string, HeartbeatDefinition>();

  register(definition: HeartbeatDefinition): void {
    if (this.heartbeats.has(definition.name)) {
      throw new Error(
        `OutboxHeartbeatRegistry: heartbeat "${definition.name}" is already registered`,
      );
    }
    this.heartbeats.set(definition.name, definition);
  }

  getAll(): HeartbeatDefinition[] {
    return [...this.heartbeats.values()];
  }

  /**
   * Drop every registration. The registry is a module singleton that outlives
   * the App, so `resetApp()` must clear it — otherwise re-initialising a
   * worker-role App (as the integration suites do) hits the
   * already-registered throw above.
   */
  clear(): void {
    this.heartbeats.clear();
  }
}

/**
 * Process-singleton registry. Consumers register against this from any
 * process role — registration is passive data, so a web process can
 * import the same registration module a worker uses without firing
 * anything (the scheduler is worker-only). Exposed as a singleton so a
 * consumer module doesn't need to plumb the registry instance through
 * its registration site.
 */
export const outboxHeartbeatRegistry = new OutboxHeartbeatRegistry();
