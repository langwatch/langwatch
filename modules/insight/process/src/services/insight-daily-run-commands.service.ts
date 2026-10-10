import type {
  InsightRunRequestedEventData,
  InsightRunSettledEventData,
  InsightRunStartedEventData,
  InsightScheduleConfiguredEventData,
  InsightScheduleTurnedOffEventData,
} from "@langwatch/insight-contract";

type CommandSender<Input> = { send(input: Input): Promise<unknown> };

type Envelope = { tenantId: string; occurredAt: number };

type InsightDailyRunCommandSenders = {
  configureSchedule: CommandSender<InsightScheduleConfiguredEventData & Envelope>;
  turnOffSchedule: CommandSender<InsightScheduleTurnedOffEventData & Envelope>;
  requestScheduleRearm: CommandSender<InsightScheduleConfiguredEventData & Envelope>;
  requestRun: CommandSender<InsightRunRequestedEventData & Envelope>;
  recordRunStarted: CommandSender<InsightRunStartedEventData & Envelope>;
  settleRun: CommandSender<InsightRunSettledEventData & Envelope>;
};

/**
 * The daily run pipeline's own senders, bound once the process registered it. A schedule's
 * setting and a run's request, start and outcome each land as an event before any row moves.
 */
export class InsightDailyRunCommandsService {
  #senders: InsightDailyRunCommandSenders | undefined;

  private constructor() {}

  static create(): InsightDailyRunCommandsService {
    return new InsightDailyRunCommandsService();
  }

  connect(senders: InsightDailyRunCommandSenders): void {
    this.#senders = senders;
  }

  async configureSchedule(input: InsightScheduleConfiguredEventData & Envelope): Promise<void> {
    await this.senders().configureSchedule.send(input);
  }

  async turnOffSchedule(input: InsightScheduleTurnedOffEventData & Envelope): Promise<void> {
    await this.senders().turnOffSchedule.send(input);
  }

  async requestScheduleRearm(input: InsightScheduleConfiguredEventData & Envelope): Promise<void> {
    await this.senders().requestScheduleRearm.send(input);
  }

  async requestRun(input: InsightRunRequestedEventData & Envelope): Promise<void> {
    await this.senders().requestRun.send(input);
  }

  async recordRunStarted(input: InsightRunStartedEventData & Envelope): Promise<void> {
    await this.senders().recordRunStarted.send(input);
  }

  async settleRun(input: InsightRunSettledEventData & Envelope): Promise<void> {
    await this.senders().settleRun.send(input);
  }

  private senders(): InsightDailyRunCommandSenders {
    if (!this.#senders) throw new Error("Daily run commands used before pipeline registration");
    return this.#senders;
  }
}
