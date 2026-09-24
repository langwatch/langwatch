import type {
  CompleteSuiteRunItemCommandData,
  RecordSuiteRunItemStartedCommandData,
} from "@langwatch/suite-contract";

type CommandSender<Payload> = { send(payload: Payload): Promise<unknown> };

/** Suite's two run-item commands, bound once the pipeline registered them. */
export type SuiteRunItemCommandSenders = {
  recordSuiteRunItemStarted: CommandSender<RecordSuiteRunItemStartedCommandData>;
  completeSuiteRunItem: CommandSender<CompleteSuiteRunItemCommandData>;
};

/**
 * Records a scenario run's start and completion against its suite run, through
 * `suite_run_processing`'s own commands (main's `suiteRuns.*` senders).
 */
export class SuiteRunItemCommandsService {
  static create(): SuiteRunItemCommandsService {
    return new SuiteRunItemCommandsService();
  }

  #senders: SuiteRunItemCommandSenders | undefined;

  private constructor() {}

  connect(senders: SuiteRunItemCommandSenders): void {
    this.#senders = senders;
  }

  async recordSuiteRunItemStarted(data: RecordSuiteRunItemStartedCommandData): Promise<void> {
    await this.#connected().recordSuiteRunItemStarted.send(data);
  }

  async completeSuiteRunItem(data: CompleteSuiteRunItemCommandData): Promise<void> {
    await this.#connected().completeSuiteRunItem.send(data);
  }

  #connected(): SuiteRunItemCommandSenders {
    if (!this.#senders) {
      throw new Error("Suite run-item commands were sent before suite_run_processing registered");
    }
    return this.#senders;
  }
}
