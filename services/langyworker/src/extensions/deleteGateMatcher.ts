/**
 * Command classification for the delete gate: turn a raw `bash` command (or the
 * text a `write`/`edit` would put on disk) into the set of destructive LangWatch
 * operations it would perform, if any.
 *
 * Every rule here fails CLOSED: a segment we cannot resolve statically is
 * reported as a hold, never waved through. The confirmation layer
 * (`deleteGateConfirmation.ts`) decides whether a *resolved* destructive
 * operation is released; the unresolvable kinds (`unparseable`, `exec-file`)
 * are held UNCONDITIONALLY and no confirmation can release them.
 */

/** A single destructive operation, identified for confirmation binding. */
export type GateTarget = {
  /** The LangWatch resource kind, e.g. `dashboard`, `dataset`. */
  resourceType: string;
  /** The resource identifier the command names, e.g. `d1`. */
  identifier: string;
};

/**
 * Why a command segment was held.
 *
 * - `cli-verb` and `http` are destructive operations the confirmation layer may
 *   release (`cli-verb` when its `target` matches a bound confirmation; `http`
 *   is never bindable and always needs a plain re-issue through the CLI).
 * - `unparseable` and `exec-file` are the fail-closed buckets: we could not
 *   prove the segment safe, which is not the same as proving it dangerous. They
 *   are held before the confirmation check ever runs.
 */
export type DestructiveMatch =
  | { kind: "cli-verb"; verb: string; segment: string; target: GateTarget | null }
  | { kind: "http"; segment: string }
  | { kind: "exec-file"; segment: string }
  | { kind: "unparseable"; segment: string };

/** Tool names whose input can reach a destructive command. */
export const GATED_TOOL_NAMES = ["bash", "write", "edit"] as const;

/**
 * Destructive verbs as the LangWatch CLI spells them. A verb counts when it
 * appears as any non-flag argument (or the right-hand side of a `--flag=value`)
 * of a `langwatch` invocation. That is position-blind, so a read-only
 * `langwatch traces list --grep delete` is a false positive — the matcher
 * cannot tell a subcommand from a flag's value without the CLI's own command
 * catalogue. Held on purpose: the alternative (skipping the token after every
 * flag) is a one-flag bypass. Kept lower-case; matching lower-cases the token.
 */
export const DESTRUCTIVE_VERBS = [
  "delete",
  "remove",
  "rm",
  "destroy",
  "archive",
  "revoke",
  "uninstall",
  "purge",
  "logout",
  // Destructive without a delete verb: `gateway-budgets reset` moves the
  // period boundary, `webhooks roll-secret` permanently kills the old signing
  // secret. `daemon stop` is deliberately absent — local process only.
  "reset",
  "roll-secret",
] as const;

/**
 * Every catalog leaf verb (last word of a `langwatch <group> ... <verb>`
 * command in `feature-map.json`) that is NOT in `DESTRUCTIVE_VERBS` and has
 * been reviewed as non-destructive — reversible (`disable`/`enable`,
 * `unplace`), read-only (`list`/`get`/`status`), or additive
 * (`create`/`add`/`upload`). The verb canary (`deleteGate.canary.test.ts`)
 * red-fails if the live catalog grows a leaf verb absent from BOTH lists,
 * forcing a human to classify it here before the build passes.
 *
 * `rotate` (virtual-keys) and `disable` are deliberately benign: a rotate
 * issues a replacement key and a disable is undone by `enable`, so neither
 * destroys data the way `revoke`/`roll-secret` do. Revisit if that changes.
 */
export const REVIEWED_BENIGN = [
  "access",
  "add",
  "admin-list",
  "assign",
  "by-user",
  "clone-from-platform",
  "codex",
  "context",
  "create",
  "deliveries",
  "dev",
  "disable",
  "download",
  "duplicate",
  "enable",
  "event-types",
  "events",
  "export",
  "get",
  "get-state",
  "health",
  "init",
  "install",
  "list",
  "list-runs",
  "permissions",
  "place",
  "pull",
  "push",
  "query",
  "rename",
  "replay",
  "report",
  "restore",
  "results",
  "rotate",
  "run",
  "schema",
  "search",
  "set",
  "set-state",
  "spend",
  "status",
  "summary",
  "sync",
  "tail",
  "test",
  "transcript",
  "types",
  "unplace",
  "unset",
  "update",
  "update-ottl-rules",
  "upload",
  "versions",
] as const;

/**
 * Top-level LangWatch resource groups (the first token after `langwatch`).
 * Used to bind a confirmation's (resource-type, identifier) to a command's:
 * both the assistant's ask and the command must name the same resource type
 * for a "yes" to authorize the delete.
 */
export const RESOURCE_TYPES = new Set([
  "trace",
  "traces",
  "session",
  "analytics",
  "annotation",
  "experiment",
  "monitor",
  "scenario",
  "scenarios",
  "simulation-run",
  "suite",
  "prompt",
  "agent",
  "workflow",
  "evaluator",
  "dataset",
  "dashboard",
  "graph",
  "chart",
  "trigger",
  "virtual-keys",
  "gateway-budgets",
  "webhooks",
  "spend-events",
  "governance",
  "ingest",
  "projects",
  "api-keys",
  "organization",
  "organizations",
  "members",
  "invites",
  "teams",
  "groups",
  "roles",
  "role-bindings",
  "scim-tokens",
  "model-provider",
  "secret",
  "model-default",
  "skills",
]);

/** Binaries that front the CLI without being it. Stripped before matching. */
const RUNNER_WRAPPERS = new Set(["npx", "pnpx", "bunx", "sudo", "env", "command", "exec", "time", "nohup"]);

/** `pnpm|yarn|npm|bun <sub> langwatch ...` — the sub-word is dropped too. */
const PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn", "bun"]);
const PACKAGE_MANAGER_SUBCOMMANDS = new Set(["exec", "run", "dlx", "x", "--"]);

/** Names the CLI answers to on a PATH. */
const CLI_NAMES = new Set(["langwatch", "lw"]);

/**
 * Shell interpreters that run a file the gate never sees. Executing an
 * agent-written file through any of these is unresolvable and held
 * unconditionally.
 */
const FILE_EXECUTORS = new Set(["bash", "sh", "zsh", "dash", "ksh", "source", "."]);

/** HTTP clients whose invocations reach the REST/GraphQL delete surface. */
const HTTP_CLIENTS = new Set(["curl", "http", "https", "wget", "fetch", "xh"]);

/** Shell metacharacters that make a segment unresolvable without executing it. */
const UNRESOLVABLE = /[$`]|<\(/;

const DESTRUCTIVE_VERB_SET = new Set<string>(DESTRUCTIVE_VERBS);

/**
 * A GraphQL document is destructive when it carries a `mutation` whose fields
 * name a destructive operation. A `query {…}` document, or a mutation that only
 * creates/updates/renames, is a read/write we do not gate.
 */
const GRAPHQL_DESTRUCTIVE = /\bmutation\b[\s\S]*\b(delete|archive|remove|purge|destroy|revoke)/i;

/** REST paths whose method-agnostic intent is destructive (`POST /purge`). */
const DESTRUCTIVE_PATH = /\/(purge|delete|archive|destroy|remove|revoke|reset)\b/i;

/**
 * Split a command line on the operators that start a new command. Deliberately
 * crude: it does not understand quoting, so a `;` inside a quoted string
 * over-splits. Over-splitting only ever produces MORE segments to inspect,
 * which is the safe direction. Newlines split too, so `write`/`edit` file
 * content is inspected line by line.
 */
export function splitSegments(command: string): string[] {
  return command
    .split(/\|\||&&|[;\n|&]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/** Whitespace tokenizer that strips one layer of matched quotes per token. */
export function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(segment)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}

/** Drop `FOO=bar` prefixes, runner wrappers, and package-manager preambles. */
function stripPreamble(tokens: string[]): string[] {
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index += 1;
      continue;
    }
    const base = token.split("/").pop() ?? token;
    if (RUNNER_WRAPPERS.has(base)) {
      index += 1;
      continue;
    }
    if (PACKAGE_MANAGERS.has(base)) {
      index += 1;
      while (index < tokens.length && PACKAGE_MANAGER_SUBCOMMANDS.has(tokens[index] ?? "")) index += 1;
      continue;
    }
    break;
  }
  return tokens.slice(index);
}

/** The destructive verb a token carries, honouring `--flag=verb` and case. */
function verbOfToken(token: string): string | null {
  if (token.startsWith("-")) {
    // Inspect the right-hand side of an `=`-form flag: `--x=delete`.
    const eq = token.indexOf("=");
    if (eq === -1) return null;
    const value = token.slice(eq + 1).replace(/^["']|["']$/g, "").toLowerCase();
    return DESTRUCTIVE_VERB_SET.has(value) ? value : null;
  }
  const lower = token.toLowerCase();
  return DESTRUCTIVE_VERB_SET.has(lower) ? lower : null;
}

/**
 * The (resource-type, identifier) a resolved CLI delete acts on: the first
 * resource-group token after the CLI name, and the first bare argument after
 * the destructive verb. Null when either cannot be read (e.g. the verb hid in a
 * `--flag=` value), which the confirmation layer treats as un-bindable → held.
 */
function commandTarget(stripped: string[], verbIndex: number): GateTarget | null {
  let resourceType: string | null = null;
  for (let i = 1; i < stripped.length; i += 1) {
    const token = stripped[i] ?? "";
    if (token.startsWith("-")) continue;
    const lower = token.toLowerCase();
    if (RESOURCE_TYPES.has(lower)) {
      resourceType = lower;
      break;
    }
    // First non-flag token that is not a known resource type: stop looking, the
    // shape is not one we can bind.
    break;
  }
  let identifier: string | null = null;
  for (let i = verbIndex + 1; i < stripped.length; i += 1) {
    const token = stripped[i] ?? "";
    if (token.startsWith("-")) continue;
    identifier = token;
    break;
  }
  if (!resourceType || !identifier) return null;
  return { resourceType, identifier };
}

/** Classify an HTTP-client segment; null when it is a benign call. */
function classifyHttp(segment: string): DestructiveMatch | null {
  // Only LangWatch hosts carry LangWatch data. A destructive call elsewhere is
  // not this gate's concern.
  if (!/langwatch/i.test(segment)) return null;

  const explicitMethod = segment.match(/(?:-X|--request)\s*=?\s*["']?([A-Za-z]+)/i);
  const hasBody = /(?:-d|--data|--data-raw|--data-binary|--data-urlencode|--json)\b/.test(segment);
  const method = (explicitMethod?.[1] ?? (hasBody ? "POST" : "GET")).toUpperCase();

  if (method === "GET" || method === "HEAD") return null;
  if (method === "DELETE") return { kind: "http", segment };
  if (method === "PUT" || method === "PATCH") return { kind: "http", segment };
  if (method === "POST") {
    if (GRAPHQL_DESTRUCTIVE.test(segment)) return { kind: "http", segment };
    if (DESTRUCTIVE_PATH.test(segment)) return { kind: "http", segment };
    return null; // read-query GraphQL POST or a create/update endpoint → benign.
  }
  return null;
}

/**
 * Classify one command segment. Returns null only when the segment is both
 * parseable AND provably not a destructive LangWatch call.
 */
function classifySegment(segment: string): DestructiveMatch | null {
  const mentionsCli = /\blangwatch\b|\blw\b/.test(segment);

  // A segment we cannot resolve statically is held whenever it could reach the
  // product: command substitution, variable expansion, and process
  // substitution can all spell any command at all.
  if (UNRESOLVABLE.test(segment)) {
    return { kind: "unparseable", segment };
  }

  const tokens = tokenize(segment);
  if (tokens.length === 0) return null;

  // Unbalanced quotes: the tokenizer's output does not describe the command.
  const doubleQuotes = (segment.match(/"/g) ?? []).length;
  const singleQuotes = (segment.match(/'/g) ?? []).length;
  if (doubleQuotes % 2 !== 0 || singleQuotes % 2 !== 0) {
    return { kind: "unparseable", segment };
  }

  const stripped = stripPreamble(tokens);
  const head = stripped[0] ?? "";
  const headBase = head.split("/").pop() ?? head;

  // Executing an agent-written file: the shell resolves file contents the gate
  // never sees, so it is unresolvable and held unconditionally.
  if (FILE_EXECUTORS.has(headBase) && stripped.length > 1) {
    return { kind: "exec-file", segment };
  }
  if (/^\.{1,2}\//.test(head)) {
    return { kind: "exec-file", segment };
  }

  if (CLI_NAMES.has(headBase)) {
    for (let i = 1; i < stripped.length; i += 1) {
      const token = stripped[i] ?? "";
      const verb = verbOfToken(token);
      if (verb) {
        return { kind: "cli-verb", verb, segment, target: commandTarget(stripped, i) };
      }
    }
    return null;
  }

  // The REST/GraphQL API is the same delete surface without the CLI in front.
  if (HTTP_CLIENTS.has(headBase)) {
    return classifyHttp(segment);
  }

  // The CLI is named but we did not recognise the invocation shape — a shell
  // function, an alias, a here-doc, a wrapper script. Hold it.
  if (mentionsCli && !CLI_NAMES.has(headBase)) {
    return { kind: "unparseable", segment };
  }

  return null;
}

/** Every destructive operation a command would perform, across all segments. */
export function findDestructiveMatches(command: string): DestructiveMatch[] {
  const matches: DestructiveMatch[] = [];
  for (const segment of splitSegments(command)) {
    const match = classifySegment(segment);
    if (match) matches.push(match);
  }
  return matches;
}

/**
 * The first destructive intent in a raw bash command, or null when the command
 * is provably benign. Retained for callers that want a single verdict.
 *
 * @param command - the `command` field of a bash tool call.
 */
export function findDestructiveIntent(command: string): DestructiveMatch | null {
  return findDestructiveMatches(command)[0] ?? null;
}

/** A stable key for a target, for set membership. */
export function targetKey(target: GateTarget): string {
  return `${target.resourceType} ${target.identifier}`;
}
