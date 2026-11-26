import {
  cliToolResultPayload,
  extractPlatformUrl,
  type LangwatchCommand,
  parseCliToolResult,
  toRelativeSameOriginHref,
} from "@langwatch/langy-contract";
import { z } from "zod";

import type { LangyApiMap } from "../../../../behavior/langy-api.ts";
import { commandsOfToolCall } from "../../../../model/langy-capability-digest.ts";
import { extractPrimaryId, extractToolText } from "../../../../model/langy-capability-registry.ts";

/** A tRPC router the Langy dock's typed api declares, so an invalidation path is checked. */
export type LangyRouter = keyof LangyApiMap;

/**
 * The one map from a Langy CLI resource to the app's tRPC routers whose cached reads it can
 * change. A router path invalidates every query under it, so a new list query on an existing
 * router is covered without touching this file.
 * @see specs/langy/langy-dashboard-widget-refresh.feature
 */
const ROUTERS_BY_RESOURCE: Readonly<Record<string, readonly LangyRouter[]>> = {
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
  dashboard: ["boards", "dashboards", "dashboardWidgets", "graphs"],
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

/**
 * Verbs that only name a subcommand group (`dataset records add`, `teams members add`): what the
 * command does is the word after them.
 */
const SUBCOMMAND_GROUPS: ReadonlySet<string> = new Set([
  "records",
  "members",
  "bindings",
  "widget",
  "tag",
  "version",
  "ingestion-templates",
]);

/**
 * Every CLI action that only reads. Anything else changes state, so a verb the CLI adds later
 * refreshes by default: a spare refetch is cheap, a stale list is the bug.
 */
const READ_ACTIONS: ReadonlySet<string> = new Set([
  "list",
  "get",
  "search",
  "query",
  "versions",
  "status",
  "schema",
  "results",
  "health",
  "get-state",
  "events",
  "types",
  "summary",
  "state",
  "tail",
  "sample",
  "report",
  "reference",
  "fires",
  "fields",
  "facets",
  "export",
  "examples",
  "event-types",
  "estimate",
  "download",
  "docs",
  "commands",
  "help",
  "help-tree",
  "by-user",
  "access",
  "permissions",
  "actions",
  "list-runs",
  "admin-list",
  "deliveries",
  "spend",
  "transcript",
  "open",
  "navigate",
  "whoami",
]);

/** The action a command performs: its verb, or the subcommand under a group verb. */
function actionOf({ verb, args }: Pick<LangwatchCommand, "verb" | "args">): string {
  if (!SUBCOMMAND_GROUPS.has(verb)) return verb;
  const positionals = args._;
  const subcommand = Array.isArray(positionals) ? positionals[0] : undefined;
  return typeof subcommand === "string" ? subcommand : verb;
}

/** The routers to invalidate once this command's result lands; empty for a read. */
export function routersRefreshedByWrite({
  resource,
  verb,
  args = {},
}: {
  resource: string;
  verb: string;
  args?: Record<string, unknown>;
}): readonly LangyRouter[] {
  if (args.help !== undefined || args.h !== undefined) return [];
  if (READ_ACTIONS.has(actionOf({ verb, args }))) return [];
  return ROUTERS_BY_RESOURCE[resource] ?? [];
}

const settledToolPartSchema = z.object({
  type: z.string(),
  state: z.literal("output-available"),
  toolCallId: z.string(),
  toolName: z.string().optional(),
  input: z.unknown(),
  output: z.unknown().optional(),
});

function toolNameOf({ type, toolName }: { type: string; toolName?: string }): string | undefined {
  if (type === "dynamic-tool") return toolName;
  return type.startsWith("tool-") ? type.slice("tool-".length) : undefined;
}

/** Whether this command makes a new board (`dashboard create`), not a widget on one. */
function createsBoard(command: Pick<LangwatchCommand, "resource" | "verb" | "args">): boolean {
  return command.resource === "dashboard" && actionOf(command) === "create";
}

/** The board a `dashboard create` made, read from its output: a JSON document or its text. */
export type LangyCreatedBoard = { id: string | null; platformUrl: string | null };

function createdBoardOf(output: unknown): LangyCreatedBoard | null {
  const envelope = parseCliToolResult(output) ?? parseCliToolResult(extractToolText(output));
  const documents = [
    envelope ? cliToolResultPayload(envelope) : null,
    output,
    parseJsonObject(extractToolText(output)),
  ];
  for (const document of documents) {
    const platformUrl = extractPlatformUrl(document);
    const id = extractPrimaryId(null, document);
    if (platformUrl || id) return { id, platformUrl };
  }
  return null;
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** A settled tool call's writes: the routers to refresh, and the board it made, if any. */
export type LangySettledWrite = {
  callId: string;
  routers: readonly LangyRouter[];
  createdBoard: LangyCreatedBoard | null;
};

/**
 * The routers a message part's writes refresh, once its result has landed, across every
 * `langwatch` invocation the call chained; null for any part that is not a settled tool call.
 */
export function settledWriteOf(part: unknown): LangySettledWrite | null {
  const parsed = settledToolPartSchema.safeParse(part);
  if (!parsed.success) return null;
  const name = toolNameOf(parsed.data);
  if (!name) return null;
  const commands = commandsOfToolCall({ name, input: parsed.data.input });
  const routers = new Set(commands.flatMap((command) => routersRefreshedByWrite(command)));
  const createdBoard = commands.some(createsBoard) ? createdBoardOf(parsed.data.output) : null;
  return { callId: parsed.data.toolCallId, routers: [...routers], createdBoard };
}

const PROJECT_DASHBOARDS = /^\/([^/]+)\/dashboards(?:\/|$)/;
const ORGANIZATION_DASHBOARDS = /^\/dashboards(?:\/|$)/;

/**
 * Where to take a reader who is on a dashboards page when Langy makes a new board: that board,
 * in the same area. Null off the dashboards pages, where the card's link is enough.
 * @see specs/langy/langy-dashboard-widget-refresh.feature
 */
export function createdBoardDestination({
  board,
  pathname,
  origin,
}: {
  board: LangyCreatedBoard;
  pathname: string;
  origin: string;
}): string | null {
  const project = PROJECT_DASHBOARDS.exec(pathname);
  const atOrganization = ORGANIZATION_DASHBOARDS.test(pathname);
  if (!project && !atOrganization) return null;
  const precise = board.platformUrl
    ? toRelativeSameOriginHref({ url: board.platformUrl, origin })
    : null;
  if (precise) return precise;
  if (!board.id) return null;
  const id = encodeURIComponent(board.id);
  return project ? `/${project[1]}/dashboards/${id}` : `/dashboards/${id}`;
}
