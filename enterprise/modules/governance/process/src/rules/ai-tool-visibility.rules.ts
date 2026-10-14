// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AiToolEntry } from "@langwatch/enterprise-governance-contract";

function isDepartmentBound(entry: AiToolEntry): boolean {
  return entry.departmentIds.length > 0 || entry.scope === "department";
}

/**
 * The entries a member sees (main `aiToolEntry.service.ts:693-775`): department-bound entries only
 * for that department's members, and a department entry shadows an org-wide one of the same slug.
 */
export function selectVisibleAiTools({
  entries,
  departmentId,
}: {
  entries: readonly AiToolEntry[];
  departmentId: string | null;
}): AiToolEntry[] {
  const visible = entries.filter(
    (entry) =>
      !isDepartmentBound(entry) ||
      (departmentId !== null && entry.departmentIds.includes(departmentId)),
  );
  const bySlug = new Map<string, AiToolEntry>();
  for (const entry of visible) {
    const existing = bySlug.get(entry.slug);
    if (!existing || (isDepartmentBound(entry) && !isDepartmentBound(existing))) {
      bySlug.set(entry.slug, entry);
    }
  }
  return [...bySlug.values()];
}

/** The first published Claude Code source's OTLP path, or null (main `routers/aiTools.ts:129-142`). */
export function selectClaudeCodeOtlpEndpoint(
  sources: readonly { id: string; sourceType: string; status: string; createdAtMs: number }[],
): { endpoint: string | null } {
  const [first] = sources
    .filter((source) => source.sourceType === "claude_code" && source.status !== "disabled")
    .toSorted((left, right) => left.createdAtMs - right.createdAtMs);
  return { endpoint: first ? `/api/ingest/otel/${first.id}` : null };
}
