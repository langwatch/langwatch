interface PendingCall<Input, Output> {
  input: Input;
  resolve: (output: Output) => void;
  reject: (error: unknown) => void;
}

/**
 * Calls of one script issued in one turn of the event loop leave in one round trip: a lone call
 * through `one`, as before; several through `many`, each caller keeping its own answer or failure.
 * `process.nextTick` runs after every continuation woken by the same Redis reply has had its turn.
 */
export class ScriptCallBatcher<Input, Output> {
  private pending: PendingCall<Input, Output>[] = [];

  constructor(
    private readonly calls: {
      one: (input: Input) => Promise<Output>;
      many: (inputs: readonly Input[]) => Promise<PromiseSettledResult<Output>[]>;
    },
  ) {}

  call(input: Input): Promise<Output> {
    return new Promise<Output>((resolve, reject) => {
      if (this.pending.push({ input, resolve, reject }) === 1) {
        process.nextTick(() => this.flush());
      }
    });
  }

  private flush(): void {
    const batch = this.pending;
    this.pending = [];
    const [only] = batch;
    if (!only) return;
    if (batch.length === 1) {
      void this.calls.one(only.input).then(only.resolve, only.reject);
      return;
    }
    void this.calls.many(batch.map((pending) => pending.input)).then(
      (results) => {
        batch.forEach((pending, index) => {
          const result = results[index];
          if (!result) pending.reject(new Error("A batched script call came back without a reply"));
          else if (result.status === "fulfilled") pending.resolve(result.value);
          else pending.reject(result.reason);
        });
      },
      (error: unknown) => {
        for (const pending of batch) pending.reject(error);
      },
    );
  }
}
