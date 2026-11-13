/**
 * The pure decisions of an organization copy (module ADR-002): which approvals pair up, which
 * source projects a copy takes, and how its report adds up.
 */
import type { StaffAccessScope } from "@langwatch/authz-contract";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import type {
  StaffAccessCopyItem,
  StaffAccessCopyOutcome,
  StaffAccessCopyReport,
} from "@langwatch/staff-access-contract";

/** The scopes each side of a copy needs: read the source's content, write into the target. */
export const COPY_SOURCE_SCOPES: readonly StaffAccessScope[] = ["ops:copy", "org:content"];
export const COPY_TARGET_SCOPES: readonly StaffAccessScope[] = ["ops:copy", "org:support"];

/** At most this many item names go into each organization's audit row. */
export const COPY_AUDIT_NAMES_MAX = 200;

export function holdsScopes({
  scopes,
  needed,
}: {
  scopes: readonly string[];
  needed: readonly StaffAccessScope[];
}): boolean {
  return needed.every((scope) => scopes.includes(scope));
}

/** The projects a copy takes: every one when none is named, else those named by id or slug. */
export function selectProjects<Project extends { id: string; slug: string }>({
  projects,
  named,
}: {
  projects: readonly Project[];
  named: readonly string[] | undefined;
}): { selected: Project[]; unknown: string[] } {
  if (!named) return { selected: [...projects], unknown: [] };
  const selected = projects.filter((project) =>
    named.some((name) => name === project.id || name === project.slug),
  );
  const unknown = named.filter(
    (name) => !projects.some((project) => name === project.id || name === project.slug),
  );
  return { selected, unknown };
}

/** How many items ended each way. */
export function copyTotals(items: readonly StaffAccessCopyItem[]): StaffAccessCopyReport["totals"] {
  const totals: Record<StaffAccessCopyOutcome, number> = {
    planned: 0,
    copied: 0,
    already_copied: 0,
    skipped: 0,
    failed: 0,
  };
  for (const item of items) totals[item.outcome] += 1;
  return totals;
}

/** What the audit rows say a copy is about to make: kind and name, capped. */
export function auditedPlan(items: readonly StaffAccessCopyItem[]): {
  counts: Record<string, number>;
  names: string[];
} {
  const planned = items.filter((item) => item.outcome === "planned");
  const counts: Record<string, number> = {};
  for (const item of planned) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  const names = planned.slice(0, COPY_AUDIT_NAMES_MAX).map((item) => `${item.kind}: ${item.name}`);
  return { counts, names };
}

/** The reason an error gives the report: its handled code, or a plain "unexpected_error". */
export function failureReason(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as { code: unknown };
    if (typeof code === "string" && code !== "") return code;
  }
  return "unexpected_error";
}

/** One report line; what is not given is null. */
export function copyItem(
  base: Pick<StaffAccessCopyItem, "kind" | "name" | "sourceId" | "sourceProjectId">,
  outcome: StaffAccessCopyItem["outcome"],
  extra: Partial<Pick<StaffAccessCopyItem, "targetId" | "targetProjectId" | "reason">> = {},
): StaffAccessCopyItem {
  return {
    ...base,
    outcome,
    targetId: extra.targetId ?? null,
    targetProjectId: extra.targetProjectId ?? null,
    reason: extra.reason ?? null,
  };
}

type PromptSetting =
  | "temperature"
  | "maxTokens"
  | "topP"
  | "frequencyPenalty"
  | "presencePenalty"
  | "seed"
  | "topK"
  | "minP"
  | "repetitionPenalty"
  | "reasoning"
  | "verbosity"
  | "promptingTechnique"
  | "demonstrations"
  | "responseFormat";
export type PromptVersionFields = Pick<
  VersionedPrompt,
  "prompt" | "messages" | "inputs" | "outputs" | "model"
> &
  Partial<Pick<VersionedPrompt, PromptSetting>>;

/** The configuration one prompt version carries; ids, authors, tags and lineage stay behind. */
export function promptFields(version: VersionedPrompt): PromptVersionFields {
  return {
    prompt: version.prompt,
    messages: version.messages,
    inputs: version.inputs,
    outputs: version.outputs,
    model: version.model,
    ...(version.temperature === undefined ? {} : { temperature: version.temperature }),
    ...(version.maxTokens === undefined ? {} : { maxTokens: version.maxTokens }),
    ...(version.topP === undefined ? {} : { topP: version.topP }),
    ...(version.frequencyPenalty === undefined
      ? {}
      : { frequencyPenalty: version.frequencyPenalty }),
    ...(version.presencePenalty === undefined ? {} : { presencePenalty: version.presencePenalty }),
    ...(version.seed === undefined ? {} : { seed: version.seed }),
    ...(version.topK === undefined ? {} : { topK: version.topK }),
    ...(version.minP === undefined ? {} : { minP: version.minP }),
    ...(version.repetitionPenalty === undefined
      ? {}
      : { repetitionPenalty: version.repetitionPenalty }),
    ...(version.reasoning === undefined ? {} : { reasoning: version.reasoning }),
    ...(version.verbosity === undefined ? {} : { verbosity: version.verbosity }),
    ...(version.promptingTechnique === undefined
      ? {}
      : { promptingTechnique: version.promptingTechnique }),
    ...(version.demonstrations === undefined ? {} : { demonstrations: version.demonstrations }),
    ...(version.responseFormat === undefined ? {} : { responseFormat: version.responseFormat }),
  };
}
