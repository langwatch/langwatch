import type { ClickHouseClient } from "./graph-trigger-heartbeat.service.ts";

/** Process logger used by graph evaluation and heartbeat isolation. */
export abstract class AutomationLogger {
  abstract error(fields: Record<string, unknown>, message: string): void;
  abstract debug(fields: Record<string, unknown>, message: string): void;
  abstract info(fields: Record<string, unknown>, message: string): void;
  abstract warn(fields: Record<string, unknown>, message: string): void;
}

/** Technical ClickHouse resolver used only by the heartbeat recency query. */
export abstract class AutomationHeartbeat {
  abstract tryResolveClickHouseClient(projectId: string): Promise<ClickHouseClient | null>;
}

/** Host transport semantics for retryable and terminal delivery failures. */
export abstract class AutomationDispatchError {
  abstract isTerminal(error: unknown): boolean;
  abstract createTerminal(message: string): unknown;
}
