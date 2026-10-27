import {
  TriggerNotFoundError,
  triggerSchema,
  type CreateTriggerCommand,
  type Trigger,
  type TriggerSummary,
  type UpdateTriggerCommand,
  type AutomationUsageCount,
} from "@langwatch/automation-contract";
import { generate } from "@langwatch/ksuid";
import { nowInstant, toDate } from "@langwatch/time";

import {
  TriggerRepository,
  type ReportScheduleTarget,
  type TriggerJsonColumn,
  type TriggerJsonText,
  type TriggerJsonTextOutcome,
} from "../trigger.repository.ts";
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

  /** The memory tier holds its secrets in plaintext: nothing it stores outlives the process. */
  openSecret({ sealed }: { sealed: string }): string {
    return sealed;
  }

  sealSecret({ plain }: { plain: string }): string {
    return plain;
  }

  countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<AutomationUsageCount> {
    const made = this.rows()
      .filter((row) => projectIds.includes(row.projectId))
      .map((row) => row.createdAt.getTime());
    return Promise.resolve({
      triggers: made.filter((at) => since === undefined || at >= since).length,
      ...(made.length === 0 ? {} : { firstTriggerAt: Math.min(...made) }),
    });
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

  findAllReportTargets(): Promise<ReportScheduleTarget[]> {
    return Promise.resolve(
      this.rows()
        .filter((row) => row.triggerKind === "REPORT" && !row.deleted)
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

  /** One column, read and written in the same tick, as Prisma's column update is. */
  updateLastRunAt(input: { triggerId: string; projectId: string }): Promise<void> {
    const row = this.memory.triggers.get(input.triggerId);
    if (row?.projectId === input.projectId) {
      this.write({ ...row, lastRunAt: toDate(nowInstant()) });
    }
    return Promise.resolve();
  }

  async findByIdOrThrow(input: { triggerId: string; projectId: string }): Promise<Trigger> {
    const row = await this.findById(input);
    if (row === null) throw new TriggerNotFoundError();
    return row;
  }

  findById(input: { triggerId: string; projectId: string }): Promise<Trigger | null> {
    const row = this.memory.triggers.get(input.triggerId);
    return Promise.resolve(row?.projectId === input.projectId ? row : null);
  }

  findSlackTriggers(input: { projectIds: readonly string[] }): Promise<Trigger[]> {
    return Promise.resolve(
      this.rows()
        .filter(
          (row) =>
            input.projectIds.includes(row.projectId) &&
            row.action === "SEND_SLACK_MESSAGE" &&
            !row.deleted,
        )
        .toSorted((left, right) => left.createdAt.getTime() - right.createdAt.getTime()),
    );
  }

  findActiveSlackTriggerPage({
    after,
    limit,
  }: {
    after?: string;
    limit: number;
  }): Promise<Trigger[]> {
    return Promise.resolve(
      this.rows()
        .filter(
          (row) =>
            row.action === "SEND_SLACK_MESSAGE" &&
            row.active &&
            !row.deleted &&
            (after === undefined || row.id > after),
        )
        .toSorted((left, right) => Number(left.id > right.id) - Number(left.id < right.id))
        .slice(0, limit),
    );
  }

  replaceActionParamsIfUnchanged(input: {
    triggerId: string;
    projectId: string;
    expected: unknown;
    actionParams: Record<string, unknown>;
  }): Promise<boolean> {
    const row = this.memory.triggers.get(input.triggerId);
    const unchanged =
      row?.projectId === input.projectId &&
      JSON.stringify(row.actionParams ?? {}) === JSON.stringify(input.expected ?? {});
    if (row && unchanged) this.write({ ...row, actionParams: input.actionParams });
    return Promise.resolve(unchanged);
  }

  findJsonTextPage({
    after,
    limit,
  }: {
    after?: string;
    limit: number;
  }): Promise<TriggerJsonText[]> {
    return Promise.resolve(
      [...this.memory.triggerJsonText.entries()]
        .flatMap(([id, text]) => {
          const row = this.memory.triggers.get(id);
          if (!row || (text.filters === undefined && text.actionParams === undefined)) return [];
          return [
            {
              id,
              projectId: row.projectId,
              filters: text.filters ?? null,
              actionParams: text.actionParams ?? null,
            },
          ];
        })
        .filter((row) => after === undefined || row.id > after)
        .toSorted((left, right) => Number(left.id > right.id) - Number(left.id < right.id))
        .slice(0, limit),
    );
  }

  unwrapJsonText(input: {
    triggerId: string;
    projectId: string;
    column: TriggerJsonColumn;
    text: string;
  }): Promise<TriggerJsonTextOutcome> {
    const row = this.memory.triggers.get(input.triggerId);
    const stored = this.memory.triggerJsonText.get(input.triggerId);
    if (row?.projectId !== input.projectId || stored?.[input.column] !== input.text) {
      return Promise.resolve("changed");
    }
    // Postgres's jsonb refuses a NUL escape; the live tier reports it and leaves the text.
    if (/\\u0000/i.test(input.text)) return Promise.resolve("unparseable");
    this.dropJsonText({ triggerId: input.triggerId, columns: [input.column] });
    this.write({ ...row, [input.column]: JSON.parse(input.text) as Record<string, unknown> });
    return Promise.resolve("unwrapped");
  }

  findAllByProjectId(input: { projectId: string }): Promise<Trigger[]> {
    return Promise.resolve(
      this.rows()
        .filter((row) => row.projectId === input.projectId && !row.deleted)
        .toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime()),
    );
  }

  findByCustomGraphId(input: {
    projectId: string;
    customGraphId: string;
  }): Promise<Trigger | null> {
    const row = this.rows().find(
      (candidate) =>
        candidate.projectId === input.projectId && candidate.customGraphId === input.customGraphId,
    );
    return Promise.resolve(row ?? null);
  }

  findByCustomGraphIds(input: { projectId: string; customGraphIds: string[] }): Promise<Trigger[]> {
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
    const now = toDate(nowInstant());
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
    const row = triggerSchema.parse({ ...stored, ...changes, updatedAt: toDate(nowInstant()) });
    this.write(row);
    this.dropJsonText({
      triggerId: row.id,
      columns: (["filters", "actionParams"] as const).filter(
        (column) => input[column] !== undefined,
      ),
    });
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

  /** A write stores an object, as the live tier does, so the column no longer holds text. */
  private dropJsonText({
    triggerId,
    columns,
  }: {
    triggerId: string;
    columns: readonly TriggerJsonColumn[];
  }): void {
    const text = this.memory.triggerJsonText.get(triggerId);
    if (!text) return;
    const rest = { ...text };
    for (const column of columns) delete rest[column];
    this.memory.triggerJsonText.set(triggerId, rest);
  }

  private rows(): Trigger[] {
    return [...this.memory.triggers.values()];
  }

  private write(row: Trigger): void {
    this.memory.triggers.set(row.id, row);
  }
}
