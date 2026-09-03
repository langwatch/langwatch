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
       * by quotes or a backslash so its literal is never contiguous — the
       * confirmation layer surfaces a targeted "write the command name plainly"
       * reason for it instead of the generic re-issue list. Absent for every
       * other unresolvable cause (substitution, an unquoted glob or brace, an
       * unrecognised wrapper, unbalanced quotes), which fall back to the generic
       * re-issue reason.
       */
      cause?: "obfuscated-command-name";
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
 * unresolvable and held unconditionally. Beyond the POSIX-ish core, the
 * alternative shells an agent could reach on a real box are enumerated too
 * (`fish`, `csh`/`tcsh`, `ash`, PowerShell as `pwsh`/`powershell`, and the
 * newer `nu`/`xonsh`/`elvish`/`rc`/`oil`/`osh`) so a hand-off to any of them is
 * held on the same footing as `bash`.
 */
const FILE_EXECUTORS = new Set([
  "bash",
  "sh",
  "zsh",
  "dash",
  "ksh",
  "source",
  ".",
  "fish",
  "csh",
  "tcsh",
  "ash",
  "pwsh",
  "powershell",
  "nu",
  "xonsh",
  "elvish",
  "rc",
  "oil",
  "osh",
]);

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
 * Runtime EXPANSION is no longer modelled: `classifySegment` holds any unquoted
 * glob metacharacter (`*`, `?`, `[`) or brace (`{`, `}`) anywhere in the segment,
 * in any command head, as unresolvable — so an executor or verb reassembled by a
 * glob (`/bin/ba*sh`, `/bin/[!c]ash`, `/bin/[[:alpha:]]ash`) or a brace group
 * (`{ba,}sh`, `dele{,}te`) is held on that structural rule before this scan runs,
 * rather than by ten separate models of bash expansion. Quoted/escaped forms
 * stay literal and allowed.
 *
 * Residuals still NOT caught, by design (out of scope for a static gate):
 *  - a name inside a SINGLE quoted string handed to a non-executor wrapper
 *    (`env -S "python3 -c …"`, one argument): the interpreter is not its own word.
 *  - `bash5` / `bash.exe`-style aliases: a shell name carrying a suffix neither
 *    `FILE_EXECUTORS` membership nor the interpreter-version regex covers.
 *  - GNU `sed`'s `e` flag/command, which executes shell from a sed script.
 *  - heredoc bodies (see the `splitSegments`/heredoc note below).
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
 *  - `xargs`, `find -exec`, `parallel`: pass arguments to a command, they do not
 *    concatenate strings — a `langwatch` they invoke is a literal token caught by
 *    `mentionsCli`. A hand-off to a shell or code interpreter (`xargs sh -c`,
 *    `find … -exec python3 {} \;`) IS closed: the executor is a bare argv token,
 *    so the any-token executor scan in `classifySegment` holds it regardless of
 *    which runner fronts it. Holding all `find`/`xargs` outright would over-block
 *    routine use.
 *  - `env -S bash`, `busybox sh` (applet dispatch): CLOSED by the same any-token
 *    scan — the interpreter (`bash`/`sh`/`python3`) is itself a bare word in the
 *    segment, so a wrapper in front of it (`busybox`, or `env` stripped as a runner
 *    wrapper leaving `-S bash`) no longer hides it. The narrow residual that remains
 *    is a SINGLE-QUOTED-STRING form where the interpreter name is not its own word
 *    (`env -S "python3 -c …"`, one argument), or a concat payload assembling the
 *    interpreter name at runtime — recorded in the threat model, not closed here.
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

/**
 * The shells and code interpreters whose presence ANYWHERE in a segment holds it:
 * either executor family runs content the gate never resolves (a script file,
 * stdin, or inline/runtime-built code). Scanned as any bare argv token, not just
 * the head — see the executor scan in `classifySegment` for why. `.` / `source`
 * are excluded off-head (handled specially there): off-head `.` is find's
 * current-directory argument, and neither builtin can be exec'd as an external
 * program by a wrapper's argv.
 */
const SEGMENT_EXECUTORS = new Set<string>([...FILE_EXECUTORS, ...CODE_INTERPRETERS]);

/**
 * Version- and point-release-suffixed forms of the language interpreters, the
 * way they are actually installed on a PATH (`python3.12`, `python3.11`,
 * `pypy3`, `node`/`nodejs`, `php8.3`, `lua5.4`, `ruby3.2`). Exact-set membership
 * alone missed every one of these, so a versioned interpreter could head a
 * segment and slip the executor hold. The base name is the WHOLE word (we match
 * against the already-taken basename), anchored at both ends, so an over-block
 * on lookalikes is avoided: `python3-config`, `node_modules`, `perl-doc`,
 * `bash.md` and `python3.12.txt` do NOT match (the tail after the digits must be
 * empty or a run of `.<digits>`). Shells are NOT in here — they are matched by
 * exact `FILE_EXECUTORS` membership — so `bash5`/`sh5` remain documented
 * residuals rather than false hits on a real basename ending in a digit.
 *
 * The second alternative covers CPython's debug builds (`python3-dbg`,
 * `python3d`, and their point-release forms `python3.11-dbg` / `python3.11d`),
 * which the digit-suffix rule alone would miss because their tail is `-dbg`/`d`,
 * not `.<digits>`. `python3-config`/`python3-doc` still do NOT match.
 */
const VERSIONED_INTERPRETER =
  /^(?:(?:python|pypy|python3|pypy3|node|nodejs|ruby|perl|php|lua|luajit)\d*(?:\.\d+)*|python3(?:\.\d+)*(?:-dbg|d))$/;

/**
 * True when a basename is a shell or code interpreter the gate holds: an exact
 * member of `SEGMENT_EXECUTORS`, or a versioned interpreter form. Callers pass a
 * lower-cased basename (path prefix and case already stripped).
 */
function matchesExecutor(base: string): boolean {
  return SEGMENT_EXECUTORS.has(base) || VERSIONED_INTERPRETER.test(base);
}

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
 * to its bash word value before the verb match runs. A BRACE splice in an
 * ARGUMENT (`dele{,}te`) is not resolved here at all — the structural expansion
 * pass in `classifySegment` holds any unquoted brace or glob unconditionally, so
 * it never reaches the verb/resource match. This head regex still matches a
 * brace group spliced into the command NAME (`lang{,}watch`) so that obfuscation
 * gets the targeted `obfuscated-command-name` reason rather than the generic one.
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
 * Split a command line on the operators that start a new command (`;`, newline,
 * `|`, `||`, `&`, `&&`), honouring quoting the way bash does: an operator inside
 * single or double quotes, or backslash-escaped, is literal text and does NOT
 * start a new segment (`grep -E '(a|b)' f` is one command, not two). Splitting
 * elsewhere still errs toward MORE segments, the safe direction; newlines split
 * too, so `write`/`edit` file content is inspected line by line.
 */
export function splitSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i] ?? "";
    if (c === "\\" && !inSingle) {
      current += c;
      if (i + 1 < command.length) {
        current += command[i + 1];
        i += 1;
      }
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      current += c;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      current += c;
      continue;
    }
    if (!inSingle && !inDouble && (c === ";" || c === "\n" || c === "|" || c === "&")) {
      segments.push(current);
      current = "";
      // `||` and `&&` consume their second char so it does not open an empty
      // segment; a lone `|`/`&`/`;`/newline separates just the same.
      if ((c === "|" && command[i + 1] === "|") || (c === "&" && command[i + 1] === "&")) {
        i += 1;
      }
      continue;
    }
    current += c;
  }
  segments.push(current);
  return segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0);
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
 * word boundary starts a comment that ends the segment. Neither brace nor glob
 * expansion is performed here — the metacharacters are copied literally into both
 * `raw` and `value`; a word-internal brace group in the HEAD is caught by
 * `HEAD_SPLICE` on `raw`, and any other unquoted brace or glob metacharacter is
 * held by the structural expansion pass in `classifySegment`.
 * `unterminated` is true when a quote is opened and never closed, which means
 * the parse does not describe the command and the segment must be held.
 */
export function shellWords(segment: string): { words: Word[]; unterminated: boolean } {
  const words: Word[] = [];
  let unterminated = false;
  let i = 0;
  const n = segment.length;
  while (i < n) {
    // Unquoted `(` / `)` are bash metacharacters that group a subshell — they
    // are not part of any word, so they separate words exactly like whitespace.
    // Consuming them here turns `(bash script.sh)` into the words `bash`,
    // `script.sh` (it lexed as one word `(bash` before). `$(`/`<(` never reach
    // this lexer: a segment carrying `$` or `<(` is held by UNRESOLVABLE first.
    while (i < n && (/\s/.test(segment[i] ?? "") || segment[i] === "(" || segment[i] === ")"))
      i += 1;
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
      // An unquoted `(` or `)` ends the current word (see the leading skip).
      if (c === "(" || c === ")") break;
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
 * True when a word's verbatim source carries an unquoted, unescaped shell
 * EXPANSION metacharacter — a glob char (`*`, `?`, `[`) or a brace (`{`, `}`).
 * These are exactly the characters bash expands at runtime into words the gate
 * never sees, so any word containing one (outside single quotes, double quotes,
 * and not backslash-escaped) is unresolvable and held on the same fail-closed
 * footing as `$`/backtick/`<(`. We deliberately do NOT model what the expansion
 * would produce — ten rounds of modelling brace/glob expansion piecemeal each
 * left a sibling hole open, so the whole class is held instead. Quoted or
 * escaped forms (`'*.ts'`, `"{a,b}"`, `\*`) are literal text to bash and are not
 * flagged. The caller separately exempts the standalone `[`/`]` test builtin and
 * `{`/`}` group-command braces, whose whole word is one of those characters.
 */
function hasUnquotedExpansionChar(raw: string): boolean {
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
    } else if (
      !inSingle &&
      !inDouble &&
      (c === "*" || c === "?" || c === "[" || c === "{" || c === "}")
    ) {
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
  // A segment we cannot resolve statically is held UNCONDITIONALLY — command
  // substitution, variable expansion, and process substitution can each spell any
  // command at all, so the segment is fail-closed whether or not it mentions
  // LangWatch. This deliberately holds even a non-LangWatch `echo $HOME` or
  // `` ls `pwd` ``: the gate cannot prove such a segment is not a destructive
  // LangWatch call, and fail-closed is the design.
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

  // Structural expansion hold: any word carrying an UNQUOTED glob metacharacter
  // (`*`, `?`, `[`) or brace (`{`, `}`), anywhere in the segment and in any
  // command head, is held UNCONDITIONALLY as unresolvable — the same fail-closed
  // bucket as `$`/backtick/`<(` above. bash would expand these at runtime into
  // words the gate never sees (a glob resolving to `/bin/bash`, a brace group
  // reassembling a destructive verb or an executor name), and modelling that
  // expansion piecemeal repeatedly left a sibling hole open, so the whole class
  // is held instead. Two standalone-word exceptions stay allowed: `[`/`]` are
  // the POSIX `test` builtin, and `{`/`}` are shell group-command braces (a bare
  // `bash` inside `{ bash; }` is still caught by the executor scan below on its
  // own word). Quoted/escaped forms (`'*.ts'`, `"{a,b}"`, `\*`) are literal.
  for (const word of stripped) {
    if (
      word.value === "[" ||
      word.value === "]" ||
      word.value === "{" ||
      word.value === "}"
    ) {
      continue;
    }
    if (hasUnquotedExpansionChar(word.raw)) {
      return { kind: "unparseable", segment };
    }
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

  // A shell or code interpreter ANYWHERE in the segment runs content the gate
  // never resolves — a script file (`bash f.sh`), stdin when run bare (`… | bash`,
  // `cat f.sh | bash`), or inline/runtime-built code (`python3 -c …`) — so the
  // moment one appears as a bare argv token the segment is held UNCONDITIONALLY,
  // before the CLI/HTTP checks below.
  //
  // The scan is any-token, NOT head-only, because a wrapper in front of the
  // executor becomes the head and a head-only hold never fires. Adding wrappers to
  // a strip-list is not the fix — flag-taking wrappers (`nice -n 10 bash`,
  // `timeout 5 sh`) and unknown ones (`foo bar bash`) still bypass it. Scanning
  // every word covers the wrappered forms, and folds in what the old
  // ARGV_RUNNERS/HANDOFF_EXECUTORS special case did for `xargs sh -c` and
  // `find … -exec python3 {} \;` — those are just the same executor sitting in a
  // runner's argv. `.` / `source` (the source builtin) count only at the head;
  // off-head, `.` is find's current-directory argument and neither can be exec'd
  // as an external program by a wrapper.
  //
  // Each word's plain basename is tested by exact membership OR a versioned
  // interpreter form (`python3.12`, `php8.3`). A splice of the name reaches this
  // scan already resolved: quote/backslash splices are collapsed to their word
  // VALUE by the lexer, and any unquoted glob or brace splice was already held by
  // the structural expansion pass above (before this scan runs), so no
  // brace/glob-specific branch is needed here.
  //
  // What this scan covers: quote/backslash splices of the name and an arbitrary
  // chain of wrappers and path prefixes in front of it. What remains residual: a
  // name assembled at RUNTIME from a `$VAR` (already held by UNRESOLVABLE), a name
  // embedded inside a single quoted string that is not its own word (`env -S
  // "python3 -c …"`), and a shell name carrying a suffix the interpreter regex
  // does not cover (`bash5`, `bash.exe`).
  //
  // Accepted over-block, fail-closed by design: a plain word that merely EQUALS an
  // interpreter name is held too — `echo bash`, `grep python3 file`, `which sh`,
  // and even a `langwatch` delete whose identifier is literally `bash`. A filename
  // that only RESEMBLES one is NOT held, because its basename differs (`cat bash.md`,
  // `ls ./sh.txt`, `ls python3/` whose trailing-slash basename is empty), and a
  // quoted multi-word value never equals a bare name (`git commit -m "run bash later"`).
  for (let i = 0; i < stripped.length; i += 1) {
    const word = stripped[i];
    if (!word) continue;
    const base = (word.value.split("/").pop() ?? word.value).toLowerCase();
    if (!base) continue; // e.g. a trailing-slash path (`python3/`) — not an executable.
    if ((base === "." || base === "source") && i !== 0) continue;
    if (matchesExecutor(base)) {
      return { kind: "exec-file", segment };
    }
  }
  // A relative-path executable at the head (`./f.sh`, `../f.sh`) runs an
  // agent-written file the gate never sees. Its basename is not an executor name,
  // so the scan above does not catch it; hold it here.
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
    // A brace/glob splice in an argument (`dele{,}te`, `del{e..e}te`) never
    // reaches here: the structural expansion pass above already held any unquoted
    // brace or glob as unresolvable, so a `langwatch` invocation that survives to
    // this point carries only literal, resolvable argument tokens.
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
