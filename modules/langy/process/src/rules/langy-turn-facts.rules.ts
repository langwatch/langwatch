import { APP_ERROR_CODES, goErrorCodes } from "@langwatch/handled-error";
/**
 * Langy turns reduced to ids, codes, counts and times for the staff ops functions (ADR-202):
 * message text, commands, tool arguments, results and error text never leave these functions.
 * Spec: modules/langy/specs/langy-ops-turn-facts.feature
 */
import type {
  LangyToolCallFacts,
  LangyTurnFacts,
  LangyTurnOutcomeCount,
  LangyTurnToolCall,
} from "@langwatch/langy-contract";
import { getAllModels, modelProviders } from "@langwatch/model-provider-contract";
import { Temporal } from "@langwatch/time";

/** One stored turn with its conversation's owner and latest model, as the repository reads it. */
export type LangyTurnFactRow = Readonly<{
  projectId: string;
  conversationId: string;
  turnId: string;
  status: string;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  userId: string | null;
  model: string | null;
  toolCalls: readonly LangyTurnToolCall[];
}>;

/** What names a tool call's tool: its tool name and, for a shell call, its command. */
export type LangyToolLabelInput = Readonly<Pick<LangyTurnToolCall, "toolName" | "command">>;

/** One stored turn as the outcome counts read it: only its failed calls, only what names them. */
export type LangyTurnOutcomeRow = Readonly<{
  status: string;
  error: string | null;
  createdAt: number;
  userId: string | null;
  model: string | null;
  failedToolCalls: readonly LangyToolLabelInput[];
}>;

/** The registry's codes: a stored error leaves only as one of these, never as its own text. */
const KNOWN_CODES: ReadonlySet<string> = new Set([
  ...APP_ERROR_CODES,
  ...Object.keys(goErrorCodes),
]);
const TOOL = /^[a-z][a-z0-9_]{0,39}$/;
const CATALOGUE = getAllModels();
/** Catalogue model names without their provider: a provider serving one keeps its name. */
const CATALOGUE_MODEL_NAMES: ReadonlySet<string> = new Set(
  Object.keys(CATALOGUE).map((id) => id.slice(id.indexOf("/") + 1)),
);
const ID_VALUE = /^[A-Za-z0-9_-]{4,64}$/;
const ID_FIELD = /^([a-z][a-zA-Z]{0,30})(?:Id|_id)$/;
const ID_FLAG = /--([a-z][a-z-]{0,30})-id(?:=|\s+)(["']?)([A-Za-z0-9_-]{4,64})\2(?=\s|$)/;
const CLI_CALL = /(?:^|[\s;&|(])langwatch\s+([a-z][a-z-]{0,30})(?=\s|$)/;
const TURN_STATES = new Set(["pending", "running", "completed", "failed", "stopped"]);
const CALL_STATES = new Set(["initiated", "succeeded", "failed"]);

/** The top-level command groups of the `langwatch` CLI; any other word reads as `other`. */
const CLI_GROUPS = new Set([
  "agent",
  "agents",
  "analytics",
  "annotation",
  "annotations",
  "api-keys",
  "chart",
  "charts",
  "config",
  "dashboard",
  "dashboards",
  "dataset",
  "datasets",
  "docs",
  "evaluator",
  "evaluators",
  "experiment",
  "experiments",
  "gateway-budgets",
  "governance",
  "graph",
  "graphs",
  "help",
  "ingest",
  "ingestion-templates",
  "instant-evals",
  "members",
  "model-defaults",
  "model-providers",
  "monitor",
  "monitors",
  "navigate",
  "projects",
  "prompt",
  "prompts",
  "query",
  "run-plan",
  "run-plans",
  "scenario",
  "scenario-docs",
  "scenarios",
  "secrets",
  "sessions",
  "simulation-run",
  "simulation-runs",
  "skills",
  "status",
  "teams",
  "test-suite",
  "test-suites",
  "trace",
  "traces",
  "triggers",
  "ui",
  "virtual-keys",
  "webhooks",
  "whoami",
  "workflow",
  "workflows",
]);

/**
 * A failed turn's stored error as its code: a serialized handled error's code or a bare code the
 * error registry knows, else `other`.
 */
export function failureCodeOf(error: string): string {
  const trimmed = error.trim();
  if (KNOWN_CODES.has(trimmed)) return trimmed;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const code = (parsed as { code?: unknown } | null)?.code;
    if (typeof code === "string" && KNOWN_CODES.has(code)) return code;
  } catch {
    // Free text reads as `other` below.
  }
  return "other";
}

/** `langwatch.<group>` for a CLI call, the tool name for any other, `other` for an odd name. */
export function toolLabelOf(call: LangyToolLabelInput): string {
  const group = typeof call.command === "string" ? CLI_CALL.exec(call.command)?.[1] : undefined;
  if (group !== undefined) return `langwatch.${CLI_GROUPS.has(group) ? group : "other"}`;
  return TOOL.test(call.toolName) ? call.toolName : "other";
}

/** What a tool call aimed at; both null when it named no id-shaped target. */
export type LangyToolCallTarget = Readonly<{ kind: string | null; id: string | null }>;

const NO_TARGET: LangyToolCallTarget = { kind: null, id: null };

/** The first id-shaped value under an `<kind>Id` input field or a `--<kind>-id` flag. */
export function targetOf(call: LangyTurnToolCall): LangyToolCallTarget {
  const input = call.input;
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    for (const [field, value] of Object.entries(input)) {
      const kind = ID_FIELD.exec(field)?.[1];
      if (kind !== undefined && typeof value === "string" && ID_VALUE.test(value)) {
        return { kind: snakeOf(kind), id: value };
      }
    }
  }
  const flag = typeof call.command === "string" ? ID_FLAG.exec(call.command) : null;
  if (flag?.[1] !== undefined && flag[3] !== undefined) {
    return { kind: flag[1].replaceAll("-", "_"), id: flag[3] };
  }
  return NO_TARGET;
}

function snakeOf(camel: string): string {
  return camel.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function toolCallFactsOf(call: LangyTurnToolCall): LangyToolCallFacts {
  const target = targetOf(call);
  return {
    tool: toolLabelOf(call),
    status: CALL_STATES.has(call.status) ? call.status : "other",
    durationMs: typeof call.durationMs === "number" ? call.durationMs : null,
    waitKind: call.wait?.kind ?? null,
    targetKind: target.kind,
    targetId: target.id,
  };
}

/** One stored turn as facts. */
export function turnFactsOf(row: LangyTurnFactRow): LangyTurnFacts {
  return {
    turnId: row.turnId,
    state: turnStateOf(row.status),
    failureCode: row.error === null ? null : failureCodeOf(row.error),
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    toolCalls: row.toolCalls.map(toolCallFactsOf),
  };
}

function turnStateOf(status: string): string {
  return TURN_STATES.has(status) ? status : "other";
}

/**
 * A catalogue model as itself, also under another provider; any other name, such as a deployment
 * a customer named, as `<provider>/other`, or `other` when the provider is unknown too.
 */
export function modelLabelOf(model: string | null): string {
  if (model === null) return "unknown";
  const slash = model.indexOf("/");
  const provider = slash > 0 ? model.slice(0, slash) : "";
  const name = model.slice(slash + 1);
  if (Object.hasOwn(CATALOGUE, model) || CATALOGUE_MODEL_NAMES.has(name)) return model;
  return Object.hasOwn(modelProviders, provider) ? `${provider}/other` : "other";
}

type OutcomeGroup = {
  key: Omit<LangyTurnOutcomeCount, "toolErrorsByTool" | "turns" | "users">;
  turns: number;
  users: Set<string>;
  toolErrors: Map<string, number>;
};

function addTurn(groups: Map<string, OutcomeGroup>, row: LangyTurnOutcomeRow): void {
  const key = {
    day: Temporal.Instant.fromEpochMilliseconds(row.createdAt).toString().slice(0, 10),
    model: modelLabelOf(row.model),
    turnState: turnStateOf(row.status),
    failureCode: row.error === null ? null : failureCodeOf(row.error),
  };
  const id = [key.day, key.model, key.turnState, key.failureCode ?? ""].join("|");
  const group = groups.get(id) ?? { key, turns: 0, users: new Set(), toolErrors: new Map() };
  group.turns += 1;
  if (row.userId !== null) group.users.add(row.userId);
  for (const call of row.failedToolCalls) {
    const tool = toolLabelOf(call);
    group.toolErrors.set(tool, (group.toolErrors.get(tool) ?? 0) + 1);
  }
  groups.set(id, group);
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Turns grouped by UTC day, model, state and failure code, in key order. */
export function countTurnOutcomes(rows: readonly LangyTurnOutcomeRow[]): LangyTurnOutcomeCount[] {
  const groups = new Map<string, OutcomeGroup>();
  for (const row of rows) addTurn(groups, row);
  return [...groups.entries()]
    .toSorted(([a], [b]) => compareText(a, b))
    .map(([, group]) => ({
      ...group.key,
      toolErrorsByTool: Object.fromEntries(group.toolErrors),
      turns: group.turns,
      users: group.users.size,
    }));
}
