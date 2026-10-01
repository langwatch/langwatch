export abstract class Task {
  abstract readonly name: string;
  abstract readonly description: string;

  /** Chunked tasks should check `signal` between chunks to avoid mid-write shutdown. */
  abstract run(input: { args: readonly string[]; signal: AbortSignal }): Promise<void>;
}
