import { z } from "zod";

import type {
  TriggerJsonColumn,
  TriggerJsonText,
  TriggerRepository,
} from "../repositories/trigger.repository.ts";

/** How many triggers one page reads. */
const TRIGGER_PAGE_LIMIT = 500;

const COLUMNS: readonly TriggerJsonColumn[] = ["filters", "actionParams"];

/**
 * What an unwrap did, per column value: unwrapped into an object, left alone (text that is not a
 * JSON object), changed by another writer since the page was read, or unparseable (text the
 * database will not store as jsonb, left as it is).
 */
export interface TriggerJsonTextCounts {
  unwrapped: number;
  leftAlone: number;
  changed: number;
  unparseable: number;
}

/** Where an unwrap resumes: the last trigger id it finished, with the counts up to there. */
export const triggerJsonTextCheckpointSchema = z.object({
  after: z.string(),
  unwrapped: z.number().int().nonnegative(),
  leftAlone: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
  unparseable: z.number().int().nonnegative(),
});
export type TriggerJsonTextCheckpoint = z.infer<typeof triggerJsonTextCheckpointSchema>;

/** Where an unwrap resumes, whether it writes, and who hears each finished page. */
export interface TriggerJsonTextUnwrapInput {
  from?: TriggerJsonTextCheckpoint;
  dryRun: boolean;
  signal?: AbortSignal;
  onPage?: (checkpoint: TriggerJsonTextCheckpoint) => Promise<void>;
}

type UnwrapTriggers = Pick<TriggerRepository, "findJsonTextPage" | "unwrapJsonText">;

/** Whether `text` parses as a JSON object: the only text the unwrap rewrites. */
function holdsJsonObject(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * Rewrites Trigger `filters` and `actionParams` that an earlier release stored as JSON text into
 * the objects they encode, a page of triggers at a time. Text that is not a JSON object stays as
 * it is; the read path already answers it as `{}`. Idempotent: a rewritten value is no longer text.
 */
export class TriggerJsonTextUnwrapService {
  private constructor(private readonly deps: Readonly<{ triggers: UnwrapTriggers }>) {}

  static create(deps: { triggers: UnwrapTriggers }): TriggerJsonTextUnwrapService {
    return new TriggerJsonTextUnwrapService(deps);
  }

  /** Resumes after `from`; a dry run writes nothing and counts what it would unwrap. */
  async unwrap({
    from,
    dryRun,
    signal,
    onPage,
  }: TriggerJsonTextUnwrapInput): Promise<TriggerJsonTextCounts> {
    const counts: TriggerJsonTextCounts = {
      unwrapped: from?.unwrapped ?? 0,
      leftAlone: from?.leftAlone ?? 0,
      changed: from?.changed ?? 0,
      unparseable: from?.unparseable ?? 0,
    };
    let after = from?.after;
    let more = true;
    while (more) {
      signal?.throwIfAborted();
      const page = await this.deps.triggers.findJsonTextPage({ after, limit: TRIGGER_PAGE_LIMIT });
      for (const row of page) await this.unwrapRow({ row, dryRun, counts });
      const last = page.at(-1);
      if (last !== undefined && !dryRun) await onPage?.({ after: last.id, ...counts });
      more = last !== undefined && page.length === TRIGGER_PAGE_LIMIT;
      after = last?.id;
    }
    return counts;
  }

  private async unwrapRow({
    row,
    dryRun,
    counts,
  }: {
    row: TriggerJsonText;
    dryRun: boolean;
    counts: TriggerJsonTextCounts;
  }): Promise<void> {
    for (const column of COLUMNS) {
      const text = row[column];
      if (text === null) continue;
      if (!holdsJsonObject(text)) {
        counts.leftAlone += 1;
        continue;
      }
      if (dryRun) {
        counts.unwrapped += 1;
        continue;
      }
      const outcome = await this.deps.triggers.unwrapJsonText({
        triggerId: row.id,
        projectId: row.projectId,
        column,
        text,
      });
      counts[outcome] += 1;
    }
  }
}
