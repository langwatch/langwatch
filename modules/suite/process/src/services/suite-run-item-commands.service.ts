import type {
  CompleteSuiteRunItemCommandData,
  RecordSuiteRunItemStartedCommandData,
  RegradeSuiteRunItemCommandData,
  StartSuiteRunCommandData,
} from "@langwatch/suite-contract";

type CommandSender<Payload> = { send(payload: Payload): Promise<unknown> };

/** Suite's run and run-item commands, bound once the pipeline registered them. */
export type SuiteRunItemCommandSenders = {
  startSuiteRun: CommandSender<StartSuiteRunCommandData>;
  recordSuiteRunItemStarted: CommandSender<RecordSuiteRunItemStartedCommandData>;
  completeSuiteRunItem: CommandSender<CompleteSuiteRunItemCommandData>;
  regradeSuiteRunItem: CommandSender<RegradeSuiteRunItemCommandData>;
};

/**
 * Starts a suite run and records a scenario run's start and completion against
 * it, through `suite_run_processing`'s own commands (main's `suiteRuns.*` senders).
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

  async startSuiteRun(data: StartSuiteRunCommandData): Promise<void> {
    await this.#connected().startSuiteRun.send(data);
  }

  async recordSuiteRunItemStarted(data: RecordSuiteRunItemStartedCommandData): Promise<void> {
    await this.#connected().recordSuiteRunItemStarted.send(data);
  }

  async completeSuiteRunItem(data: CompleteSuiteRunItemCommandData): Promise<void> {
    await this.#connected().completeSuiteRunItem.send(data);
  }

  async regradeSuiteRunItem(data: RegradeSuiteRunItemCommandData): Promise<void> {
    await this.#connected().regradeSuiteRunItem.send(data);
  }

  #connected(): SuiteRunItemCommandSenders {
    if (!this.#senders) {
      throw new Error("Suite run-item commands were sent before suite_run_processing registered");
    }
    return this.#senders;
  }
}
