import {
  McpSessionRepository,
  type McpSessionRecordLookup,
  type McpSessionTransport,
} from "../mcp-session.repository.ts";

type MemoryRecord = {
  transport: McpSessionTransport;
  apiKey: string;
  projectId: string | undefined;
};

/** Session records held in this process, keys in plaintext: one replica, every record its own. */
export class MemoryMcpSessionRepository extends McpSessionRepository {
  readonly #records = new Map<string, MemoryRecord>();

  private constructor() {
    super();
  }

  static create(): MemoryMcpSessionRepository {
    return new MemoryMcpSessionRepository();
  }

  isAvailable(): boolean {
    return true;
  }

  store(input: {
    transport: McpSessionTransport;
    sessionId: string;
    apiKey: string;
    projectId?: string;
  }): Promise<void> {
    this.#records.set(`${input.transport}:${input.sessionId}`, {
      transport: input.transport,
      apiKey: input.apiKey,
      projectId: input.projectId,
    });
    return Promise.resolve();
  }

  touch(): Promise<void> {
    return Promise.resolve();
  }

  getRecord(input: {
    transport: McpSessionTransport;
    sessionId: string;
  }): Promise<McpSessionRecordLookup> {
    const record = this.#records.get(`${input.transport}:${input.sessionId}`);
    return Promise.resolve(
      record
        ? { kind: "found", apiKey: record.apiKey, projectId: record.projectId }
        : { kind: "missing" },
    );
  }

  remove(input: { transport: McpSessionTransport; sessionId: string }): Promise<void> {
    this.#records.delete(`${input.transport}:${input.sessionId}`);
    return Promise.resolve();
  }

  countLive({ apiKey }: { apiKey: string }): Promise<number> {
    let count = 0;
    for (const record of this.#records.values()) {
      if (record.apiKey === apiKey) count++;
    }
    return Promise.resolve(count);
  }
}
