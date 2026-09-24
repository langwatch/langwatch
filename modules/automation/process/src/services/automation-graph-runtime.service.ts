/** The ClickHouse query surface the runaway count reads through. */
export type ClickHouseClient = {
  query(input: {
    query: string;
    query_params: Record<string, string | number>;
    format: "JSONEachRow";
  }): Promise<{ json(): Promise<unknown> }>;
};

/** Process logger used by graph evaluation and heartbeat isolation. */
export abstract class AutomationLogger {
  abstract error(fields: Record<string, unknown>, message: string): void;
  abstract debug(fields: Record<string, unknown>, message: string): void;
  abstract info(fields: Record<string, unknown>, message: string): void;
  abstract warn(fields: Record<string, unknown>, message: string): void;
}

/** Technical ClickHouse resolver used only by the heartbeat recency query. */
export abstract class AutomationHeartbeat {
  abstract findClickHouseClient(projectId: string): Promise<ClickHouseClient | null>;
}

/** Host transport semantics for retryable and terminal delivery failures. */
export abstract class AutomationDispatchError {
  abstract isTerminal(error: unknown): boolean;
  abstract createTerminal(message: string): unknown;
}
