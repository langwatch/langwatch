import { z } from "zod";

import { type UpgradeRunPhaseView, upgradeRunPhaseViewSchema } from "./reader.schema.ts";

const storedPhaseSchema = z.object({
  ...upgradeRunPhaseViewSchema.shape,
  release: upgradeRunPhaseViewSchema.shape.release.optional().default(null),
  finishedAt: upgradeRunPhaseViewSchema.shape.finishedAt.optional().default(null),
});

/**
 * The phases a run report holds, in the order the runner wrote them. A report written before
 * phases existed holds none, and an entry that does not parse is dropped, never thrown on.
 */
export function parseRunPhases({
  report,
}: {
  report: Record<string, unknown> | null;
}): UpgradeRunPhaseView[] {
  const stored = report?.phases;
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((entry: unknown) => {
    const parsed = storedPhaseSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}
