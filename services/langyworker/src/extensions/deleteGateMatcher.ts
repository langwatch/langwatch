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
  /**
   * The destructive verb, e.g. `delete`, `archive`. Bound into the confirmation
   * key so a "yes" to `delete dataset d1` authorizes ONLY that verb — not
   * `purge`/`archive` of the same resource.
   */
  verb: string;
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

/**
 * `pnpm|yarn|npm <sub> langwatch ...` — the sub-word is dropped too. `bun` is
 * deliberately absent: it is BOTH a package runner and a code interpreter
 * (`bun -e`, `bun run x.ts`), so stripping it as a preamble would let
 * interpreter-executed code slip past. It is held as an interpreter instead;
 * `bunx` (a `RUNNER_WRAPPER`) remains the transparent way to reach the CLI.
 */
const PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn"]);
const PACKAGE_MANAGER_SUBCOMMANDS = new Set(["exec", "run", "dlx", "x", "--"]);

/** Names the CLI answers to on a PATH. */
const CLI_NAMES = new Set(["langwatch", "lw"]);

/**
 * Shell interpreters that run a file the gate never sees. Executing an
 * agent-written file through any of these (with a script argument) is
 * unresolvable and held unconditionally.
 */
const FILE_EXECUTORS = new Set(["bash", "sh", "zsh", "dash", "ksh", "source", "."]);

/**
 * Language interpreters whose executed code is lexically unresolvable to this
 * gate: inline code (`-c`/`-e`/`-r`/`--eval`), a script file, or code fed on
 * stdin can spell any destructive LangWatch call — and runtime string-building
 * (`'lang'+'watch ...'`) defeats every substring check. So an interpreter at a
 * segment head is held UNCONDITIONALLY, like write-then-exec: no confirmation
 * releases it. Enumerated so a newly-relevant interpreter missing from this set
 * is a conscious omission the canary (`deleteGate.canary.test.ts`) surfaces.
 *
 * `awk`/`gawk`/`mawk` are here because awk has `system()` plus native string
 * concatenation (`"lang" "watch"`), so `awk 'BEGIN{system("lang" "watch" " …")}'`
 * assembles the CLI name at runtime past every substring check — the awk-shaped
 * twin of the Python concat bypass.
 *
 * Deliberately NOT added, each judged already-covered or an accepted residual
 * (a head-based hold would over-block their overwhelmingly benign everyday use):
 *  - `sed`/`gsed`: GNU sed's `e` command/flag can exec, but a LITERAL `langwatch`
 *    in a sed script already trips the `mentionsCli` unparseable hold below, a
 *    quote-splice trips `QUOTE_SPLICE`, and sed has no practical runtime
 *    string-concatenation primitive to assemble the CLI name otherwise. Holding
 *    every `sed 's/…/…/'` would be ruinous over-block for near-zero marginal gain.
 *  - `xargs`, `find -exec`: pass arguments to a command, they do not concatenate
 *    strings — a `langwatch` they invoke is a literal token caught by
 *    `mentionsCli`. Holding all `find`/`xargs` would over-block routine use.
 *  - `env -S`, `busybox` (applet dispatch): head-based detection sees `env`
 *    (stripped as a runner wrapper) or `busybox`, not the interpreter behind it,
 *    so a concat payload wrapped in either is a known residual — narrow, and
 *    unlikely in the worker image. Recorded in the threat model, not closed here.
 */
export const CODE_INTERPRETERS = new Set([
  "python",
  "python2",
  "python3",
  "node",
  "nodejs",
  "deno",
  "bun",
  "ruby",
  "perl",
  "php",
  "rscript",
  "osascript",
  "groovy",
  "lua",
  "tclsh",
  "elixir",
  "awk",
  "gawk",
  "mawk",
]);

/** HTTP clients whose invocations reach the REST/GraphQL delete surface. */
const HTTP_CLIENTS = new Set(["curl", "http", "https", "wget", "fetch", "xh"]);

/** Shell metacharacters that make a segment unresolvable without executing it. */
const UNRESOLVABLE = /[$`]|<\(/;

/**
 * A quote character glued to word text on BOTH sides — the bash native
 * quote-splice (`lang""watch` → `langwatch`, `l"w"` → `lw`, `lang''watch` →
 * `langwatch`). The shell strips the quotes and joins the neighbours into one
 * word, so the literal `langwatch`/`lw` the head resolution and `mentionsCli`
 * substring check both look for is never contiguous in the source — the segment
 * would be waved through. It is held as unresolvable instead, fail-closed.
 *
 * The both-sides-word requirement is what keeps legitimate quoted arguments out:
 * `--name "my dataset"`, `echo "hello world"`, `grep -r "foo" .` each put a quote
 * next to whitespace (or a shell boundary) on at least one side, never word text
 * on both, so none match.
 */
const QUOTE_SPLICE = /[A-Za-z0-9]["']+[A-Za-z0-9]/;

const DESTRUCTIVE_VERB_SET = new Set<string>(DESTRUCTIVE_VERBS);

/**
 * A GraphQL document is destructive when it carries a `mutation` whose fields
 * name a destructive operation. A `query {…}` document, or a mutation that only
 * creates/updates/renames, is a read/write we do not gate.
 */
const GRAPHQL_DESTRUCTIVE = /\bmutation\b[\s\S]*\b(delete|archive|remove|purge|destroy|revoke)/i;

/**
 * Route-only destructive actions: real REST endpoints whose intent is
 * destructive but whose path segment is NOT one of the CLI's `DESTRUCTIVE_VERBS`
 * (so deriving the path set from the verbs alone would miss them). Kept as the
 * single place a route-only action is added.
 *  - `regenerate-api-key` — POST /api/projects/:id/regenerate-api-key
 *    (`platform/app/src/app/api/projects/[[...route]]/app.ts`) invalidates the
 *    old key.
 * `roll-secret` (POST /endpoints/:id/roll-secret) is already a `DESTRUCTIVE_VERB`.
 *
 * NOTE: a full REST-route inventory canary (walking every registered route the
 * way the verb canary walks the CLI catalogue) is a follow-up, not built here.
 */
const ROUTE_ONLY_DESTRUCTIVE_ACTIONS = ["regenerate-api-key"] as const;

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
}

/**
 * REST paths whose method-agnostic intent is destructive (`POST /purge`,
 * `POST /roll-secret`). Derived from the SAME `DESTRUCTIVE_VERBS` the CLI matcher
 * uses, plus the route-only actions above, so the HTTP and CLI surfaces cannot
 * drift apart.
 */
const DESTRUCTIVE_PATH = new RegExp(
  `/(?:${[...DESTRUCTIVE_VERBS, ...ROUTE_ONLY_DESTRUCTIVE_ACTIONS]
    .map(escapeForRegExp)
    .join("|")})\\b`,
  "i",
);

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
function commandTarget(
  stripped: string[],
  verbIndex: number,
  verb: string,
): GateTarget | null {
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
  return { verb, resourceType, identifier };
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
  // substitution can all spell any command at all — and a bash native
  // quote-splice (`lang""watch`) reassembles `langwatch`/`lw` past every
  // substring check, so it is unresolvable to static inspection just the same.
  if (UNRESOLVABLE.test(segment) || QUOTE_SPLICE.test(segment)) {
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
  // Lower-cased so an upper-cased head (`PYTHON3 -c`, `BASH f.sh`, `CURL -X`)
  // cannot dodge a membership check whose sets are all lower-case.
  const headBase = (head.split("/").pop() ?? head).toLowerCase();

  // A language interpreter runs code the gate never resolves — inline (`-c`),
  // from a script file, or on stdin — and runtime string-building defeats every
  // substring check. Held UNCONDITIONALLY the moment one heads a segment, even
  // bare (a bare interpreter in a pipeline reads stdin). This sits before the
  // CLI/HTTP checks so `python3 -c "...langwatch..."` can never fall through to
  // the substring fallback below. Interpreters behind a runner/env preamble
  // (`sudo python3 -c`, `FOO=1 node x.js`) are already stripped to this head.
  if (CODE_INTERPRETERS.has(headBase)) {
    return { kind: "exec-file", segment };
  }

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
        return { kind: "cli-verb", verb, segment, target: commandTarget(stripped, i, verb) };
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
 * A stable key for a target, for set membership. The verb is folded in so a
 * confirmation binds to one destructive verb only: a "yes" to `delete dataset
 * d1` yields `delete dataset d1`, which never matches an `archive`/`purge` of
 * the same resource.
 */
export function targetKey(target: GateTarget): string {
  return `${target.verb} ${target.resourceType} ${target.identifier}`;
}
