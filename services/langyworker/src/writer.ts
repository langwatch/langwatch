/**
 * The single ordered protocol writer. Every protocol line goes through one
 * instance of this class, which serializes writes through a promise chain and
 * resolves each write only when the stream's write callback fires (data handed
 * to the OS pipe), so a flushed terminal line can never be lost on exit.
 */

export type ProtocolSink = (
  chunk: string,
  callback: (error?: Error | null) => void,
) => boolean;

export class ProtocolWriter {
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly sink: ProtocolSink) {}

  /**
   * Enqueue one protocol event. Returns a promise that resolves when the line
   * has been flushed to the pipe; most callers fire-and-forget, terminal
   * writers await it.
   */
  emit(event: object): Promise<void> {
    const line = `${JSON.stringify(event)}\n`;
    this.chain = this.chain.then(() => this.writeLine(line));
    return this.chain;
  }

  /** Resolves when everything enqueued so far has been flushed. */
  flush(): Promise<void> {
    return this.chain;
  }

  private writeLine(line: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        this.sink(line, (error) => {
          if (error) {
            // The pipe is gone (manager died). There is no one to tell;
            // stderr is the only remaining channel.
            process.stderr.write(`langy-worker: stdout write failed: ${error.message}\n`);
          }
          resolve();
        });
      } catch (error) {
        process.stderr.write(
          `langy-worker: stdout write threw: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        resolve();
      }
    });
  }
}
