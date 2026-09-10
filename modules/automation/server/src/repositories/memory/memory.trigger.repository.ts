import {
  TriggerNotFoundError,
  triggerSchema,
  type CreateTriggerCommand,
  type Trigger,
  type TriggerSummary,
  type UpdateTriggerCommand,
} from "@langwatch/automation-contract";
import { generate } from "@langwatch/ksuid";
import { TriggerRepository, type ReportScheduleTarget } from "../trigger.repository.ts";
import type { MemoryAutomationStore } from "./memory.automation.store.ts";

const EMPTY_TEMPLATES = {
  slackTemplateType: null,
  slackTemplate: null,
  emailSubjectTemplate: null,
  emailBodyTemplate: null,
};

export class MemoryTriggerRepository extends TriggerRepository {
  private constructor(private readonly memory: MemoryAutomationStore) {
    super();
  }

  static create(memory: MemoryAutomationStore): MemoryTriggerRepository {
    return new MemoryTriggerRepository(memory);
  }

  findActiveForProject(projectId: string): Promise<TriggerSummary[]> {
    return Promise.resolve(
      this.rows().filter((row) => row.projectId === projectId && row.active && !row.deleted),
    );
  }

  findActiveReportTargets(): Promise<ReportScheduleTarget[]> {
    return Promise.resolve(
      this.rows()
        .filter((row) => row.triggerKind === "REPORT" && row.active && !row.deleted)
        .map((row) => ({ id: row.id, projectId: row.projectId, actionParams: row.actionParams })),
    );
  }

  claimSend(input: { triggerId: string; traceId: string; projectId: string }): Promise<boolean> {
    if (this.claimed(input)) return Promise.resolve(false);
    this.memory.sends.push({ ...input });
    return Promise.resolve(true);
  }

  isSendClaimed(input: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    return Promise.resolve(this.claimed(input));
  }

  findClaimedTraceIds(input: {
    triggerId: string;
    traceIds: string[];
    projectId: string;
  }): Promise<Set<string>> {
    const claimed = this.memory.sends
      .filter(
        (send) =>
          send.triggerId === input.triggerId &&
          send.projectId === input.projectId &&
          input.traceIds.includes(send.traceId),
      )
      .map((send) => send.traceId);
    return Promise.resolve(new Set(claimed));
  }

  async updateLastRunAt(input: { triggerId: string; projectId: string }): Promise<void> {
    const row = await this.tryFindById(input);
    if (row === null) return;
    this.write({ ...row, lastRunAt: new Date() });
  }

  async findByIdOrThrow(input: { triggerId: string; projectId: string }): Promise<Trigger> {
    const row = await this.tryFindById(input);
    if (row === null) throw new TriggerNotFoundError();
    return row;
  }

  tryFindById(input: { triggerId: string; projectId: string }): Promise<Trigger | null> {
    const row = this.memory.triggers.get(input.triggerId);
    return Promise.resolve(row?.projectId === input.projectId ? row : null);
  }

  findAllByProjectId(input: { projectId: string }): Promise<Trigger[]> {
    return Promise.resolve(
      this.rows()
        .filter((row) => row.projectId === input.projectId && !row.deleted)
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()),
    );
  }

  tryFindByCustomGraphId(input: {
    projectId: string;
    customGraphId: string;
  }): Promise<Trigger | null> {
    const row = this.rows().find(
      (candidate) =>
        candidate.projectId === input.projectId && candidate.customGraphId === input.customGraphId,
    );
    return Promise.resolve(row ?? null);
  }

  findByCustomGraphIds(input: {
    projectId: string;
    customGraphIds: string[];
  }): Promise<Trigger[]> {
    if (input.customGraphIds.length === 0) return Promise.resolve([]);
    return Promise.resolve(
      this.rows().filter(
        (row) =>
          row.projectId === input.projectId &&
          row.customGraphId !== null &&
          input.customGraphIds.includes(row.customGraphId),
      ),
    );
  }

  create(input: CreateTriggerCommand): Promise<Trigger> {
    const command: Record<string, unknown> = { ...input };
    const now = new Date();
    const row = triggerSchema.parse({
      active: true,
      deleted: false,
      pausedReason: null,
      pausedAt: null,
      message: null,
      alertType: null,
      customGraphId: null,
      filterQuery: null,
      notificationCadence: "immediate",
      traceDebounceMs: 0,
      templates: EMPTY_TEMPLATES,
      createdAt: now,
      updatedAt: now,
      ...command,
      id: command.id ?? generate("trigger").toString(),
      triggerKind: command.triggerKind ?? "AUTOMATION",
      actionParams: command.actionParams ?? {},
      filters: command.filters ?? {},
      lastRunAt: command.lastRunAt ?? now,
    });
    this.write(row);
    return Promise.resolve(row);
  }

  async update(input: UpdateTriggerCommand): Promise<Trigger> {
    const changes: Record<string, unknown> = { ...input };
    const stored = await this.findByIdOrThrow({
      triggerId: input.id,
      projectId: input.projectId,
    });
    const row = triggerSchema.parse({ ...stored, ...changes, updatedAt: new Date() });
    this.write(row);
    return row;
  }

  private claimed(input: { triggerId: string; traceId: string; projectId: string }): boolean {
    return this.memory.sends.some(
      (send) =>
        send.triggerId === input.triggerId &&
        send.traceId === input.traceId &&
        send.projectId === input.projectId,
    );
  }

  private rows(): Trigger[] {
    return [...this.memory.triggers.values()];
  }

  private write(row: Trigger): void {
    this.memory.triggers.set(row.id, row);
  }
}
