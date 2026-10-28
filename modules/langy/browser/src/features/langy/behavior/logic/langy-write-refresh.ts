import { cliVerbTone } from "@langwatch/langy-contract";
import { z } from "zod";

import { commandOfToolCall } from "../../../../model/langy-capability-digest.ts";
import { effectiveToolName } from "../../model/logic/langy-tool-label.ts";

/**
 * The one map from a Langy CLI resource to the app's tRPC routers whose cached reads it can
 * change. A router path invalidates every query under it, so a new list query on an existing
 * router is covered without touching this file.
 * @see specs/langy/langy-dashboard-widget-refresh.feature
 */
const ROUTERS_BY_RESOURCE: Readonly<Record<string, readonly string[]>> = {
  scenario: ["scenarios", "suites"],
  "test-suite": ["suites", "scenarios"],
  "run-plan": ["suites", "scenarios"],
  "simulation-run": ["scenarios", "suites"],
  evaluator: ["evaluators"],
  monitor: ["monitors"],
  dataset: ["dataset", "datasetRecord"],
  prompt: ["prompts", "promptTags"],
  agent: ["agents"],
  workflow: ["workflow"],
  experiment: ["experiments", "batchRecord"],
  annotation: ["annotation", "annotationScore"],
  dashboard: ["dashboards", "dashboardWidgets", "graphs"],
  graph: ["graphs", "dashboardWidgets"],
  chart: ["graphs", "dashboardWidgets"],
  "analytics-report": ["graphs", "dashboardWidgets"],
  trigger: ["automation"],
  secret: ["secrets"],
  "model-provider": ["modelProvider"],
  "model-default": ["modelProvider"],
  projects: ["project"],
  members: ["organization"],
  invites: ["invite"],
  teams: ["team"],
  groups: ["group"],
  organization: ["organization"],
  organizations: ["organization"],
};

/**
 * Catalogue resources that refresh nothing: reads only, results shown in the chat itself, or
 * settings pages whose router the app has not declared yet (a gap, not a decision).
 */
export const LANGY_UNREFRESHED_RESOURCES: ReadonlySet<string> = new Set([
  "trace",
  "session",
  "analytics",
  "query",
  "ui",
  "workbench",
  "instant-eval",
  "slack-connection",
  "api-keys",
  "virtual-keys",
  "gateway-budgets",
  "webhooks",
  "spend-events",
  "governance",
  "roles",
  "role-bindings",
  "grants",
  "scim-tokens",
  "ingest",
  "onboarding",
]);

/** Verbs that change state without a write tone: they start work that lands in a list. */
const STATE_CHANGING_VERBS: ReadonlySet<string> = new Set(["run", "cancel", "move"]);

/** The routers to invalidate once this command's result lands; empty for a read. */
export function routersRefreshedByWrite({
  resource,
  verb,
}: {
  resource: string;
  verb: string;
}): readonly string[] {
  if (cliVerbTone(verb) === "read" && !STATE_CHANGING_VERBS.has(verb)) return [];
  return ROUTERS_BY_RESOURCE[resource] ?? [];
}

const settledToolPartSchema = z.object({
  type: z.string(),
  state: z.literal("output-available"),
  toolCallId: z.string(),
  toolName: z.string().optional(),
  input: z.unknown(),
});

function toolNameOf({ type, toolName }: { type: string; toolName?: string }): string | undefined {
  if (type === "dynamic-tool") return toolName;
  return type.startsWith("tool-") ? type.slice("tool-".length) : undefined;
}

/**
 * The routers a message part's write refreshes, once its result has landed; null for any part
 * that is not a settled tool call (text, a call still running, a failure).
 */
export function settledWriteOf(
  part: unknown,
): { callId: string; routers: readonly string[] } | null {
  const parsed = settledToolPartSchema.safeParse(part);
  if (!parsed.success) return null;
  const name = toolNameOf(parsed.data);
  if (!name) return null;
  const command = commandOfToolCall({
    name: effectiveToolName(name, parsed.data.input),
    input: parsed.data.input,
  });
  const routers = command ? routersRefreshedByWrite(command) : [];
  return { callId: parsed.data.toolCallId, routers };
}
