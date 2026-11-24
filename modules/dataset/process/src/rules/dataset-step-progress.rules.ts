import { z } from "zod";

/** A total a resumed step carries; missing, negative or malformed, it starts at zero. */
export const carriedCount = z.number().int().nonnegative().catch(0);

/** A list a resumed step carries; missing or malformed, it starts empty. */
export function carriedList<Item extends z.ZodType>(item: Item): z.ZodCatch<z.ZodArray<Item>> {
  return z.array(item).catch([]);
}

const cursorSchema = z.object({ afterProjectId: z.string().min(1).optional().catch(undefined) });

/**
 * Where a project-by-project step resumes and the totals its earlier attempts saved. Every
 * field of `totals` must `.catch`, so a report an older release saved (only `afterProjectId`)
 * or a malformed one still resumes, with its totals from zero.
 */
export function resumedStepProgress<Totals extends z.ZodType<Record<string, unknown>>>({
  resumeFrom,
  totals,
}: {
  resumeFrom: Record<string, unknown> | null;
  totals: Totals;
}): { afterProjectId: string | undefined; totals: z.output<Totals> } {
  const saved = resumeFrom ?? {};
  return {
    afterProjectId: cursorSchema.parse(saved).afterProjectId,
    totals: totals.parse(saved),
  };
}

/** The checkpoint a step saves after a project: its totals so far and the last finished project. */
export function stepProgressReport<Totals extends Record<string, unknown>>({
  afterProjectId,
  totals,
}: {
  afterProjectId: string | undefined;
  totals: Totals;
}): Totals & { afterProjectId?: string } {
  return afterProjectId === undefined ? { ...totals } : { ...totals, afterProjectId };
}

/** Runs one project's work; when it throws, the totals so far are saved, then it rethrows. */
export async function savingProgressOnThrow({
  work,
  save,
}: {
  work: () => Promise<void>;
  save: () => Promise<void>;
}): Promise<void> {
  try {
    await work();
  } catch (error) {
    await save().catch(() => undefined);
    throw error;
  }
}
