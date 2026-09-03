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
  | {
      kind: "unparseable";
      segment: string;
      /**
       * The specific reason the segment could not be resolved, when known.
       * `obfuscated-command-name` means the head/command-name token was spliced
       * by quotes, a backslash, or a brace group so its literal is never
       * contiguous — the confirmation layer surfaces a targeted "write the
       * command name plainly" reason for it instead of the generic four-cause
       * list. `brace-expansion-budget` means a `langwatch` argument's brace
       * expansion exceeded the enumeration budget (too many results or groups)
       * or named an unenumerable/mismatched range — held fail-closed rather than
       * brace-stripped. Both fall back to the generic re-issue reason today.
       * Absent for genuinely unknown causes (substitution, wrapper, etc.).
       */
      cause?: "obfuscated-command-name" | "brace-expansion-budget";
    };

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
 *    in a sed script already trips the `mentionsCli` unparseable hold below, and
 *    sed has no practical runtime string-concatenation primitive to assemble the
 *    CLI name otherwise. A quote-splice buried inside a single-quoted sed script
 *    is a narrow accepted residual (head-scoped splice detection does not reach
 *    argument interiors); holding every `sed 's/…/…/'` would be ruinous
 *    over-block for near-zero marginal gain.
 *  - `xargs`, `find -exec`: pass arguments to a command, they do not concatenate
 *    strings — a `langwatch` they invoke is a literal token caught by
 *    `mentionsCli`. Holding all `find`/`xargs` would over-block routine use.
 *  - `env -S`, `busybox` (applet dispatch): head-based detection sees `env`
 *    (stripped as a runner wrapper) or `busybox`, not the interpreter behind it,
 *    so a concat payload wrapped in either is a known residual — narrow, and
 *    unlikely in the worker image. Recorded in the threat model, not closed here.
 *  - heredoc bodies: `splitSegments` splits on every newline regardless of
 *    heredoc context, so a heredoc body line carrying an unmatched literal quote
 *    is read as an unterminated segment and held. This fails CLOSED (an
 *    over-block, never a bypass) and heredoc bodies are rare in this agent's bash
 *    usage, so the split stays newline-crude rather than growing heredoc
 *    awareness. Accepted residual, not closed here.
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
 * A word-splice mechanism glued to word text — the ways bash collapses a token
 * into a different word than its source spells, so the literal `langwatch`/`lw`
 * that head resolution looks for is never contiguous:
 *  - quote runs:      `lang""watch` → `langwatch`, `l"w"` → `lw`, `lang''watch`
 *  - backslash escape: `lang\watch` → `langwatch`, `l\w` → `lw`
 *  - word-internal brace group: `lang{,}watch` → `langwatch`
 *
 * Applied to the HEAD/command-name token ONLY (post-preamble-stripping): a
 * spliced command name is an obfuscation we cannot resolve statically, so it is
 * held unconditionally as unresolvable, fail-closed. Scoping to the head is what
 * keeps legitimate quoted/escaped ARGUMENTS out — `git commit -m "don't crash"`,
 * `grep -rn 'foo"bar' .`, `sed 's/foo"bar"baz/qux/'` all carry word-internal
 * splices in argument position, which are not CLI-name obfuscations and must not
 * hold the segment. A quote- or backslash-splice that reassembles a destructive
 * verb in argument position is still caught: the lexer de-splices each such token
 * to its bash word value before the verb match runs. A BRACE splice is the
 * exception the lexer does not collapse (`dele{,}te` stays literal in `value`),
 * so brace groups in a `langwatch` argument get a dedicated expansion pass
 * (`bashBraceExpand`) in `classifySegment` before the verb/resource match.
 *
 * Each alternative requires word text adjacent to the splice, so a fully-quoted
 * token (`"langwatch"`, which the lexer already resolves cleanly) never matches.
 */
const HEAD_SPLICE =
  /[A-Za-z0-9]["']+[A-Za-z0-9]|[A-Za-z0-9]\\[A-Za-z0-9]|[A-Za-z0-9]\{[^}]*\}|\{[^}]*\}[A-Za-z0-9]/;

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

/**
 * One bash word: its verbatim source (`raw`, quotes/backslashes intact, for
 * head-obfuscation detection) and the word bash would produce after quote
 * removal and backslash-escape collapse (`value`, for command resolution). The
 * split is what lets the gate hold an obfuscated command NAME while still
 * resolving a spliced destructive VERB in argument position to its real value.
 */
export type Word = { raw: string; value: string };

/**
 * Split a segment into bash words, honouring quoting the way the shell does:
 * whitespace inside quotes does not break a word, and adjacent quoted/unquoted
 * runs concatenate into one word (`lang""watch` → one word `langwatch`,
 * `"de""lete"` → one word `delete`). Inside double quotes a backslash escapes
 * only `$`, backtick, `"`, `\`, and newline (bash), so `"she said \"hi\""` is
 * one word `she said "hi"`; single quotes take no escapes. An unquoted `#` at a
 * word boundary starts a comment that ends the segment. Brace expansion is NOT
 * performed here — braces are copied literally into both `raw` and `value`; a
 * word-internal brace group in the HEAD is caught by `HEAD_SPLICE` on `raw`, and
 * a comma/empty-alternative brace group in an ARGUMENT of a `langwatch`
 * invocation is expanded by `bashBraceExpand` in `classifySegment`.
 * `unterminated` is true when a quote is opened and never closed, which means
 * the parse does not describe the command and the segment must be held.
 */
export function shellWords(segment: string): { words: Word[]; unterminated: boolean } {
  const words: Word[] = [];
  let unterminated = false;
  let i = 0;
  const n = segment.length;
  while (i < n) {
    while (i < n && /\s/.test(segment[i] ?? "")) i += 1;
    if (i >= n) break;
    // An unquoted `#` at a word boundary begins a comment that runs to the end
    // of the segment (bash semantics). Stop lexing here: the comment text is not
    // part of any command, so an apostrophe or an odd quote count inside it must
    // not make the segment read as unterminated. A `#` mid-word (`foo#bar`) or
    // inside a quote (`"#notacomment"`) never reaches this point — it is consumed
    // as an ordinary word character below.
    if (segment[i] === "#") break;
    let raw = "";
    let value = "";
    while (i < n && !/\s/.test(segment[i] ?? "")) {
      const c = segment[i] ?? "";
      if (c === "'") {
        // Single quotes: everything up to the next `'` is literal, no escapes.
        raw += c;
        i += 1;
        while (i < n && segment[i] !== "'") {
          raw += segment[i];
          value += segment[i];
          i += 1;
        }
        if (i < n) {
          raw += segment[i]; // closing quote
          i += 1;
        } else {
          unterminated = true;
        }
      } else if (c === '"') {
        // Double quotes: a backslash escapes only `$`, backtick, `"`, `\`, and
        // newline (bash); before any other character it stays literal. Honouring
        // `\"` here is what keeps a real one-word argument (`"she said \"hi\""`)
        // from being mis-read as an unterminated quote.
        raw += c;
        i += 1;
        while (i < n && segment[i] !== '"') {
          if (
            segment[i] === "\\" &&
            i + 1 < n &&
            (segment[i + 1] === "$" ||
              segment[i + 1] === "`" ||
              segment[i + 1] === '"' ||
              segment[i + 1] === "\\" ||
              segment[i + 1] === "\n")
          ) {
            raw += segment[i];
            raw += segment[i + 1] ?? "";
            value += segment[i + 1] ?? ""; // escaped char is literal; backslash dropped
            i += 2;
          } else {
            raw += segment[i];
            value += segment[i];
            i += 1;
          }
        }
        if (i < n) {
          raw += segment[i]; // closing quote
          i += 1;
        } else {
          unterminated = true;
        }
      } else if (c === "\\") {
        raw += c;
        i += 1;
        if (i < n) {
          raw += segment[i];
          value += segment[i];
          i += 1;
        }
      } else {
        raw += c;
        value += c;
        i += 1;
      }
    }
    words.push({ raw, value });
  }
  return { words, unterminated };
}

/** Drop `FOO=bar` prefixes, runner wrappers, and package-manager preambles. */
function stripPreamble(words: Word[]): Word[] {
  let index = 0;
  while (index < words.length) {
    const token = words[index]?.value ?? "";
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
      while (index < words.length && PACKAGE_MANAGER_SUBCOMMANDS.has(words[index]?.value ?? "")) index += 1;
      continue;
    }
    break;
  }
  return words.slice(index);
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
 * Global expansion budget, checked BEFORE the cartesian product materialises so
 * an adversarial word (`{a..j}` glued eight times = 10^8 combos, measured at
 * 6.3s / 710MB unbudgeted) cannot exhaust the worker. A word whose expansion
 * would exceed either cap is held fail-closed (`brace-expansion-budget`), never
 * brace-stripped. `256` results covers every real reassembled verb/resource
 * (`d{el,}ete`, `data{set,}`) with wide margin; `8` groups bounds the recursion
 * depth even when each group is tiny (`{,}` × 8 = 256).
 */
const MAX_BRACE_RESULTS = 256;
const MAX_BRACE_GROUPS = 8;

/**
 * Split a brace body on its top-level commas, honouring nested braces and — the
 * bash rule the old splitter missed — quotes and backslash escapes: an escaped
 * comma (`\,`) or a quoted comma is NOT a separator, so `{\,}` and `{"a,b"}` are
 * single-element groups bash leaves literal. Quotes/escapes are copied through
 * verbatim; the final `shellWords` collapse in `bashBraceExpand` strips them.
 */
function splitTopLevelCommas(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] ?? "";
    if (ch === "\\" && !inSingle) {
      current += ch;
      if (i + 1 < body.length) {
        current += body[i + 1];
        i += 1;
      }
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
    } else if (!inSingle && !inDouble && ch === "{") {
      depth += 1;
      current += ch;
    } else if (!inSingle && !inDouble && ch === "}") {
      depth -= 1;
      current += ch;
    } else if (!inSingle && !inDouble && ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * The first brace group in `text` that bash would actually expand: one with a
 * top-level comma (`{a,b}`, `{,delete,}`) or a `..` range (`{1..3}`, `{e..e}`).
 * A literal `{foo}` (no comma, no range) is left alone, so the scan skips it and
 * looks for the next `{`. Quotes and backslash escapes suppress a brace, comma,
 * or `..` the way bash does (`"{a,b}"`, `\{`, `\,` do not expand), so an
 * argument-position quoted/escaped brace is never mistaken for an expansion.
 */
function findExpandableBrace(
  text: string,
): { start: number; end: number; isRange: boolean } | null {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] ?? "";
    if (c === "\\" && !inSingle) {
      i += 1; // the escaped character is literal
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (c !== "{" || inSingle || inDouble) continue;
    let depth = 0;
    let hasComma = false;
    let hasRange = false;
    let jSingle = false;
    let jDouble = false;
    for (let j = i; j < text.length; j += 1) {
      const d = text[j] ?? "";
      if (d === "\\" && !jSingle) {
        j += 1;
        continue;
      }
      if (d === "'" && !jDouble) {
        jSingle = !jSingle;
        continue;
      }
      if (d === '"' && !jSingle) {
        jDouble = !jDouble;
        continue;
      }
      if (jSingle || jDouble) continue;
      if (d === "{") {
        depth += 1;
      } else if (d === "}") {
        depth -= 1;
        if (depth === 0) {
          if (hasComma) return { start: i, end: j, isRange: false };
          if (hasRange) return { start: i, end: j, isRange: true };
          break; // literal `{…}`: skip it and look for the next brace group.
        }
      } else if (d === "," && depth === 1) {
        hasComma = true;
      } else if (d === "." && text[j + 1] === "." && depth === 1) {
        hasRange = true;
      }
    }
  }
  return null;
}

/** Zero-pad a signed integer to `width` the way bash does for `{01..05}`. */
function padInt(value: number, width: number): string {
  const negative = value < 0;
  const digits = Math.abs(value).toString();
  return (negative ? "-" : "") + digits.padStart(negative ? Math.max(0, width - 1) : width, "0");
}

/**
 * Enumerate a `{start..end[..step]}` range bash-faithfully, or return null when
 * it cannot be enumerated so the caller HOLDS (never brace-strips). Handles
 * integer ranges (`{1..5}`, reverse `{5..1}`, step `{1..9..2}`, zero-padded
 * `{01..05}`), single-letter ranges (`{a..e}`, reverse `{e..a}`), and the
 * degenerate single-element range (`{e..e}` → `[e]`) — the case whose old
 * brace-strip (`del{e..e}te` → `dele..ete`, not a verb) was the CRITICAL
 * bypass, since bash collapses it to `delete`. A mismatched range bash leaves
 * literal (`{a..3}`, `{1..a}`), a non-integer step, or a count over the budget
 * returns null: the gate holds fail-closed rather than reproduce bash's
 * literal-passthrough, an over-block only reachable on a `langwatch` argument.
 */
function enumerateRange(body: string): string[] | null {
  const parts = body.split("..");
  if (parts.length < 2 || parts.length > 3) return null;
  const [startRaw, endRaw, stepRaw] = parts;
  const intRe = /^-?\d+$/;
  if (intRe.test(startRaw ?? "") && intRe.test(endRaw ?? "")) {
    const start = Number(startRaw);
    const end = Number(endRaw);
    let step = 1;
    if (stepRaw !== undefined) {
      if (!intRe.test(stepRaw)) return null;
      step = Math.abs(Number(stepRaw));
      if (step === 0) return null;
    }
    const count = Math.floor(Math.abs(end - start) / step) + 1;
    if (count > MAX_BRACE_RESULTS) return null;
    const padded = /^-?0\d/.test(startRaw ?? "") || /^-?0\d/.test(endRaw ?? "");
    const width = padded
      ? Math.max((startRaw ?? "").replace("-", "").length, (endRaw ?? "").replace("-", "").length)
      : 0;
    const dir = end >= start ? 1 : -1;
    const out: string[] = [];
    for (let v = start; dir > 0 ? v <= end : v >= end; v += dir * step) {
      out.push(width > 0 ? padInt(v, width) : String(v));
    }
    return out;
  }
  const letterRe = /^[A-Za-z]$/;
  if (stepRaw === undefined && letterRe.test(startRaw ?? "") && letterRe.test(endRaw ?? "")) {
    const start = (startRaw ?? "").charCodeAt(0);
    const end = (endRaw ?? "").charCodeAt(0);
    const count = Math.abs(end - start) + 1;
    if (count > MAX_BRACE_RESULTS) return null;
    const dir = end >= start ? 1 : -1;
    const out: string[] = [];
    for (let c = start; dir > 0 ? c <= end : c >= end; c += dir) {
      out.push(String.fromCharCode(c));
    }
    return out;
  }
  return null; // mismatched or otherwise unenumerable → hold, fail-closed.
}

/**
 * Recursive brace expansion over a word's verbatim source, tracking a shared
 * `groups` budget. Returns null the instant either budget cap would be crossed
 * or a range is unenumerable — the count is accumulated as results are built and
 * checked BEFORE the array grows past the cap, so an adversarial word never
 * materialises its full cartesian product. Results are still raw (quotes/escapes
 * intact); `bashBraceExpand` collapses them to bash word values.
 */
function expandBraces(text: string, budget: { groups: number }): string[] | null {
  const brace = findExpandableBrace(text);
  if (!brace) return [text];
  budget.groups += 1;
  if (budget.groups > MAX_BRACE_GROUPS) return null;
  const pre = text.slice(0, brace.start);
  const body = text.slice(brace.start + 1, brace.end);
  const post = text.slice(brace.end + 1);
  const alternatives = brace.isRange ? enumerateRange(body) : splitTopLevelCommas(body);
  if (alternatives === null) return null;
  const postExpansions = expandBraces(post, budget);
  if (postExpansions === null) return null;
  const results: string[] = [];
  for (const alternative of alternatives) {
    const altExpansions = expandBraces(alternative, budget);
    if (altExpansions === null) return null;
    for (const expandedAlt of altExpansions) {
      for (const expandedPost of postExpansions) {
        results.push(pre + expandedAlt + expandedPost);
        if (results.length > MAX_BRACE_RESULTS) return null;
      }
    }
  }
  return results;
}

/**
 * Bash-faithful brace expansion of a single word to the list of bash word values
 * it produces, enough to unmask a destructive verb or resource type spliced apart
 * by braces (`dele{,}te` → `[delete, delete]`, `del{e..e}te` → `[delete]`,
 * `data{set,}` → `[dataset, data]`). Returns null when the expansion is held
 * fail-closed (budget exceeded or an unenumerable range) — the caller must HOLD,
 * never brace-strip. Empty alternatives (`{,delete,}`) yield empty strings here;
 * bash drops them by word splitting, but the caller only tests each result
 * against the verb/resource sets, which no empty string joins.
 */
export function bashBraceExpand(word: string): string[] | null {
  const expanded = expandBraces(word, { groups: 0 });
  if (expanded === null) return null;
  return expanded.map((piece) => shellWords(piece).words[0]?.value ?? piece);
}

/**
 * True when `raw` contains a `{` that bash would subject to brace expansion —
 * i.e. one outside any quotes and not backslash-escaped. Quoting suppresses
 * brace expansion (`"dele{,}te"` stays literal), so a quoted brace must NOT
 * trigger the argument expansion pass.
 */
function hasUnquotedBrace(raw: string): boolean {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (c === "\\" && !inSingle) {
      i += 1; // skip the escaped character
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (c === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (c === "{" && !inSingle && !inDouble) {
      return true;
    }
  }
  return false;
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
  // A segment we cannot resolve statically is held whenever it could reach the
  // product: command substitution, variable expansion, and process substitution
  // can all spell any command at all.
  if (UNRESOLVABLE.test(segment)) {
    return { kind: "unparseable", segment };
  }

  const { words, unterminated } = shellWords(segment);
  if (words.length === 0) return null;

  // A quote opened and never closed: the parse does not describe the command.
  if (unterminated) {
    return { kind: "unparseable", segment };
  }

  const stripped = stripPreamble(words);
  if (stripped.length === 0) return null;

  const headWord = stripped[0] ?? { raw: "", value: "" };

  // Head-token obfuscation: the command name is spliced by quotes, a backslash,
  // or a brace group (`lang""watch`, `lang\watch`, `lang{,}watch`), so bash
  // reassembles a real `langwatch`/`lw` invocation while its literal is never
  // contiguous in the source. We cannot resolve which command it is, so it is
  // held unconditionally — no confirmation releases an unparseable segment. An
  // ARGUMENT-position splice does NOT trip this (it is not a CLI-name
  // obfuscation), which is what keeps ordinary quoted/escaped arguments allowed.
  if (HEAD_SPLICE.test(headWord.raw)) {
    return { kind: "unparseable", segment, cause: "obfuscated-command-name" };
  }

  // From here on, resolve against the bash-word VALUES (quotes/backslashes
  // already collapsed), so a spliced destructive verb in argument position
  // (`langwatch dataset "de""lete" d1` → `delete`) is matched at its real value.
  const values = stripped.map((word) => word.value);
  // Command-name mentions of the CLI count on the collapsed value too, so an
  // unrecognised wrapper that reaches a spliced `lang""watch` is still held.
  const mentionsCli =
    /\blangwatch\b|\blw\b/.test(segment) || words.some((word) => /\blangwatch\b|\blw\b/.test(word.value));

  const head = headWord.value;
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
  if (FILE_EXECUTORS.has(headBase) && values.length > 1) {
    return { kind: "exec-file", segment };
  }
  if (/^\.{1,2}\//.test(head)) {
    return { kind: "exec-file", segment };
  }

  if (CLI_NAMES.has(headBase)) {
    for (let i = 1; i < values.length; i += 1) {
      const token = values[i] ?? "";
      const verb = verbOfToken(token);
      if (verb) {
        return { kind: "cli-verb", verb, segment, target: commandTarget(values, i, verb) };
      }
    }
    // Brace-expansion splice in argument position: the lexer copies braces
    // literally, so a comma, empty-alternative, or range group that bash would
    // expand into a destructive verb or a resource type (`dele{,}te` → `delete`,
    // `data{set,}` → `dataset`, `del{e..e}te` → `delete`) slips past the verb
    // match above. Fully brace-expand every unquoted-brace argument bash-faithful
    // (`bashBraceExpand`, ranges enumerated) and hold if any expansion is a
    // destructive verb or a resource type — a reconstructed command shape we
    // cannot bind, held unconditionally (fail-closed). A null expansion (budget
    // exceeded or an unenumerable range) is itself a hold. Quoted braces are
    // suppressed by `hasUnquotedBrace`, and routine path braces (`cp foo.{js,ts}`,
    // `mkdir src/{a,b}`) never reach here — this branch is `langwatch`-only.
    for (let i = 1; i < stripped.length; i += 1) {
      const word = stripped[i];
      if (!word || !hasUnquotedBrace(word.raw)) continue;
      const expansions = bashBraceExpand(word.raw);
      if (expansions === null) {
        // Budget overflow or an unenumerable/mismatched range: fail closed,
        // never brace-strip. bash leaves a mismatched range (`{a..3}`) literal;
        // we hold instead — an over-block reachable only on a `langwatch`
        // argument, the safe direction.
        return { kind: "unparseable", segment, cause: "brace-expansion-budget" };
      }
      for (const expansion of expansions) {
        const lower = expansion.toLowerCase();
        if (DESTRUCTIVE_VERB_SET.has(lower) || RESOURCE_TYPES.has(lower)) {
          return { kind: "unparseable", segment };
        }
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
