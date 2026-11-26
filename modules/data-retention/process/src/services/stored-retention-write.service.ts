import type {
  RetentionCategory,
  RetroactiveRetentionUpdateInput,
} from "@langwatch/data-retention-contract";
import type { EventingCommandSender } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { RecordRetentionAppliedToExistingDataCommandData } from "../eventing/data-retention-facts.commands.ts";
import type { DataRetentionService } from "./data-retention.service.ts";

/** data_retention_facts' senders, bound once the pipeline registers in this process. */
export type DataRetentionFactSenders = Readonly<{
  recordRetentionAppliedToExistingData: Pick<
    EventingCommandSender<RecordRetentionAppliedToExistingDataCommandData>,
    "send"
  >;
}>;

type StoredRetentionRewriter = Pick<
  DataRetentionService,
  "triggerRetroactiveUpdate" | "raiseStoredRetention" | "applyStoredRetention"
>;

type ProjectCategory = { projectId: string; category: RetentionCategory };

/**
 * Every rewrite of a project's stored rows, each followed by the fact peers re-time their own
 * data from (stored-object ADR-002 §5). A refused rewrite records nothing.
 */
export class StoredRetentionWriteService {
  #facts: DataRetentionFactSenders | undefined;

  private constructor(private readonly retention: StoredRetentionRewriter) {}

  static create({
    retention,
  }: {
    retention: StoredRetentionRewriter;
  }): StoredRetentionWriteService {
    return new StoredRetentionWriteService(retention);
  }

  connectFacts(senders: DataRetentionFactSenders): void {
    this.#facts = senders;
  }

  async triggerRetroactiveUpdate(
    input: RetroactiveRetentionUpdateInput,
  ): Promise<{ tables: string[] }> {
    const facts = this.#requireFacts();
    const result = await this.retention.triggerRetroactiveUpdate(input);
    await this.#record({ facts, ...input, retentionDays: input.newRetentionDays });

    return result;
  }

  async raiseStoredRetention(
    input: ProjectCategory,
  ): Promise<{ tables: string[]; retentionDays: number }> {
    const facts = this.#requireFacts();
    const result = await this.retention.raiseStoredRetention(input);
    await this.#record({
      facts,
      ...input,
      retentionDays: result.retentionDays,
      mode: "raise",
    });

    return result;
  }

  async applyStoredRetention(
    input: ProjectCategory,
  ): Promise<{ tables: string[]; retentionDays: number }> {
    const facts = this.#requireFacts();
    const result = await this.retention.applyStoredRetention(input);
    await this.#record({ facts, ...input, retentionDays: result.retentionDays });

    return result;
  }

  #requireFacts(): DataRetentionFactSenders {
    if (!this.#facts) throw new Error("data_retention_facts is not registered in this process");
    return this.#facts;
  }

  async #record({
    facts,
    projectId,
    category,
    retentionDays,
    mode,
  }: ProjectCategory & {
    facts: DataRetentionFactSenders;
    retentionDays: number;
    mode?: "raise";
  }): Promise<void> {
    await facts.recordRetentionAppliedToExistingData.send({
      tenantId: projectId,
      projectId,
      category,
      retentionDays,
      ...(mode ? { mode } : {}),
      occurredAt: nowInstant().epochMilliseconds,
    });
  }
}
