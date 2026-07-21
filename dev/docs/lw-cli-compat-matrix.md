# `lw` CLI — Agent-First Compatibility Matrix

Living document for the agent-first redesign of the LangWatch CLI (`lw`, alias of
`langwatch`). Compares our CLI against the two reference CLIs — Grafana's `gcx`
(v0.4.3) and GitHub's `gh` (v2.86.0) — capability by capability, with exact file
pointers and the phase that closes each gap.

Legend: ✅ full · ⚠️ partial · ❌ missing · n/a not applicable

Phases refer to the approved plan (branch `feat/agentix-cli`):
P1 output contract & agent mode · P2 HandledError-driven errors · P3 discoverability
(`commands`/`help-tree`) · P4 skills installer · P5 agent-native workflows.

## Matrix

| # | Capability | gcx | gh | langwatch today | Close in |
|---|---|---|---|---|---|
| 1 | Agent mode: `--agent` flag + env autodetect (`CLAUDECODE`, `CLAUDE_CODE`, `CURSOR_AGENT`, `GITHUB_COPILOT`, `AMAZON_Q`) → JSON stdout, no color/spinners, hints on stderr | ✅ | n/a | ✅ `--agent` + env autodetect (+ `LW_AGENT_MODE`/`LANGWATCH_AGENT_MODE`) in `typescript-sdk/src/cli/utils/output.ts`; wired via `preAction` → `applyOutputContext` (chalk off, spinner silent, errors structured); agent env vars forwarded to the daemon (`daemon/eligibility.ts`) | P1 |
| 2 | Uniform output contract: `-o table/json/yaml/agents`, `--jq <expr>`, `--json <fields>` on every command | ✅ | ✅ (`--json/--jq/--template`) | ⚠️ contract + flags live everywhere (`utils/output.ts` `printResult`/`resolveOutputOptions`/`registerOutputOptions`; legacy `-f/--format` + bare `--json` normalized centrally); success output routed through `printResult` on the pilot groups (traces, status, evaluator, monitor) — remaining commands still render their own tables but get machine errors/spinner-silence for free | P1 |
| 3 | Machine-readable command catalog with flags, args, hints, token-cost estimates (`gcx commands`) | ✅ | ❌ | ✅ `lw commands [--flat]` (`typescript-sdk/src/cli/commands/commands.ts`) built live from the commander tree + `feature-map.json` metadata (`cli/utils/commandCatalog.ts`); map backfilled with the 5 gateway-surface resources + per-command `hints` (43 across 10 agent-critical groups); embedded in the SDK via `copy-types.sh` → `src/internal/generated/cli/feature-map.generated.ts`; drift guarded by `src/cli/__tests__/feature-map-drift.unit.test.ts` | ~~P3~~ done |
| 4 | Compact help-tree for agent context injection (`gcx help-tree`, `# hint:`/`# skill:` annotations) | ✅ | ❌ | ✅ `lw help-tree` (`typescript-sdk/src/cli/commands/help-tree.ts`, renderer in `cli/utils/commandCatalog.ts`) — plain text in human AND agent mode, `-o json/yaml` emits the tree structure; the `status` cheat-sheet is now generated from the same catalog (`commands/status.ts`) | ~~P3~~ done |
| 5 | Self-installing bundled skills → `~/.agents/skills` (`gcx agent skills list/get/install/uninstall/update`) | ✅ | ❌ | ✅ `lw skills list\|get\|install\|uninstall\|update` (`typescript-sdk/src/cli/commands/skills/`, gcx semantics: `--all`, `--dir` (default `~/.agents`), `--dry-run`, `--force`, `-y`; recipes nest under `recipes/<slug>`; managed-by marker guards user files; non-TTY never prompts) — bundle embedded at build time by `copy-types.sh` → `scripts/generate-skills-bundle.mjs` → `src/internal/generated/cli/skills.generated.ts` (16 skills, MDX partials fully inlined, versioned by `skills/version.txt`); `npx skills add` stays as alternative (`docs/skills/directory.mdx:23`) | ~~P4~~ done |
| 6 | Backend-driven structured errors: Error / Details / Suggestions / Docs blocks + JSON envelope | ✅ | partial | ✅ CLI side complete: `CliDomainError` (`packages/cli-cards/src/domain-error.ts`) now carries `code` (+ deprecated `kind` alias), `suggestions`/`docUrl`/`traceUrl` end-to-end through `LangWatchDomainError`; dialect-1's `trace.traceId` lifted, dialects 2–3 keep `reasons`/`traceUrl`; human errors render gcx-style Error/Details/Suggestions/Docs blocks on stderr (`cli/utils/errorOutput.ts`), JSON envelope carries the full structure; code-keyed fallback explainer (`cli/utils/errorSuggestions.ts`, 10 codes) fills advice until the backend sends `suggestions` (server-sent always wins) | ~~P2~~ done (CLI); backend `suggestions` follow-up pending |
| 7 | Personalized `status`: what needs my attention | ❌ | ✅ (`gh status`) | ✅ "Needs Attention" section above the resource counts (`commands/status.ts`): errored-trace count over 24h (`traces.error` filter, `pageSize: 1` → `totalHits`), still-running experiments (latest run of the ≤5 most recently active experiments), gateway budgets ≥80% utilization (403-tolerant). Each section soft-fails independently — `null` field + per-section `errors` map in the machine document, dim note in human mode; everything fetches in one `Promise.allSettled` wave; the machine document is now `{ attention, resources }`. Monitors deliberately omitted: the monitors REST list exposes config only, no firing/health state (that lives in ClickHouse evaluation results, not the API) | ~~P5~~ done |
| 8 | Natural-language escape hatch routed to the product's assistant | ✅ (`gcx assistant prompt`) | ✅ (`gh copilot`, `gh agent-task`) | ⚠️ Langy in-product only; **no CLI `ask` yet** — P5 investigation verdict: Langy's only entry points are tRPC procedures (`langwatch/src/server/api/routers/langy.ts`) gated by a BetterAuth session cookie (no API-key plugin) plus the `release_langy_enabled` rollout flag, so a CLI holding only `LANGWATCH_API_KEY` cannot reach it. Scoped as a server follow-up — see Open items | follow-up (server endpoint) |
| 9 | Docs as markdown from the CLI (llms.txt index + pages) | ❌ | ❌ | ✅ `commands/docs.ts` (`docs`, `scenario-docs`) — ahead of both | — |
| 10 | Non-interactive auth for agents (token/device flow) | ✅ | ✅ | ✅ device flow + `--api-key` (`utils/governance/device-flow.ts`, `commands/login.ts`) | — |
| 11 | Fast cold start for agent shell-outs | ✅ (Go binary) | ✅ | ✅ warm daemon (`daemon/`) + bun-compiled binary (`scripts/build-cli-binary.ts`) | — |
| 12 | Help topics (`gh help formatting`, `environment`, `exit-codes`) | ❌ | ✅ | ✅ `lw help agent-mode` (`typescript-sdk/src/cli/commands/help.ts`) — registered as a real `help [topic]` command, which suppresses commander's implicit help command (its dispatch is internal and could never reach a topic page); `help <command>` still prints that command's help (commands are resolved before topics, so a topic can never shadow a command), unknown topics exit 1. The `agent-mode` page covers: agent mode + the 7 env vars, the output contract with examples, the structured-error document, discovery (`commands`/`help-tree`/`status`/`docs`), skills, the daemon, and piping rules | ~~P5~~ done |

## Notes per row

### 1–2. Output contract & agent mode (P1) — DONE
- Single `printResult` helper in `typescript-sdk/src/cli/utils/output.ts`; formats
  `table|json|agents|yaml` (yaml via the existing `js-yaml` dependency — no new dep).
- Legacy flags normalized centrally: `-f/--format` and bare `--json` → `-o`
  (`resolveOutputOptions`; precedence: `-o` > `--json`/`--jq`/bare `--json` >
  `-f json` > agent default `agents` > `table`).
- `--jq` is a tiny built-in subset: dot paths, `.items[]`, `.items[].field`. No jq dep.
- Global flags registered by `registerOutputOptions(program)` at the end of
  `buildProgram()` (factory semantics intact); hidden on subcommands so
  `showGlobalOptions` renders them once. Conflicts keep their local meaning
  (boolean `--json` commands, `trace export -o <file>`); pass-through wrapper
  commands (`claude`/`codex`/`cursor`/`gemini`/`opencode`) are skipped.
- Human-first default: tables + color unchanged unless `--agent`/env detection fires.
- gcx pitfall to avoid repeating: hints on **stderr** (its own skill warns `2>&1`
  breaks JSON piping). Our `errorOutput.ts` already honors this.
- Pilot groups migrated: `trace search`/`trace get`, `status`, `evaluator *`,
  `monitor *`. `trace export` deliberately NOT migrated (its `--format` is a
  file format and `-o` a file path, not the output contract).

### 3–4. Catalog & help-tree (P3) — DONE
- Base: `feature-map.json` (canonical IA per `dev/docs/adr/012-skills-information-architecture.md`
  and `013-workflow-based-onboarding.md`; update protocol in `.claude/skills/feature-map/SKILL.md`).
  Backfilled: new `ai-gateway/` category (`virtual-keys`, `gateway-budgets`,
  `governance`, `ingest`) + `settings.model-defaults` — 24 features / 33 nodes /
  128 CLI commands; `FEATURE_MAP.md` regenerated per the protocol.
- Per-command hints: additive optional `surfaces.code.hints` map (command string →
  example invocation) on the 10 agent-critical groups (43 hints); `cli` stays a
  plain string array, so the app's `featureMap.ts` and Langy consumers are untouched.
- Shipped to the SDK via the `copy-types.sh` precedent →
  `typescript-sdk/src/internal/generated/cli/feature-map.generated.ts` (typed minimal
  shape: id/name + surfaces.code cli/hints/skill; everything else passes through).
- One catalog builder (`typescript-sdk/src/cli/utils/commandCatalog.ts`) joins the
  live commander tree with the embedded map → `lw commands [--flat]` (JSON catalog:
  path/args/flags/description/hint/skill/tokenCost, wired through `printResult`),
  `lw help-tree` (compact annotated tree; plain text in human+agent mode, JSON
  structure on `-o json`), and the generated `status` cheat-sheet (was hardcoded).
  Token cost = rendered-help chars / 4, rounded up (gcx formula).
- Drift guard `typescript-sdk/src/cli/__tests__/feature-map-drift.unit.test.ts`
  (regex-parses `program.ts` like the app-side capabilityCatalog test; exclusion
  set `PLUMBING_COMMANDS` shared with the status summary) + leaf-level completeness
  in `cli/utils/__tests__/commandCatalog.unit.test.ts`. It lives in typescript-sdk
  because the app's node_modules aren't required there — the app-side test keeps
  guarding the Langy catalog.

### 5. Skills (P4) — DONE
- Bundle at build time: `copy-types.sh` → `typescript-sdk/scripts/generate-skills-bundle.mjs`
  (pure node, zero workspace deps) →
  `src/internal/generated/cli/skills.generated.ts`. Bodies are the COMMITTED
  `skills/_compiled/native/<slug>/SKILL.md` renders — produced by
  `skills/_compiler/native.ts` with the same `inlineMdx` the public publisher
  uses and pinned to the sources by `skills/_tests/native-skills.test.ts` —
  so the CLI bundle, the published repo, and Langy's native skills are one
  rendered artifact (a byte-parity test pins bundle ↔ native files). Metadata
  (name/description/user-prompt) comes from the canonical MDX sources; the
  published set (FEATURE_SKILLS + recipes, NATIVE_ONLY `github` excluded) is
  read from `skills/_lib/feature-skills.ts`; versioned by
  `skills/version.txt`. Static string literals → works in the bun single
  binary (verified: `bun run build:binary`, `skills list/get` from
  `dist/bin/langwatch`).
- `lw skills list|get <name>|install [name…] [--all] [--dir] [--dry-run]
  [--force]|uninstall [name…] [--all] [--dir] [--dry-run] [-y]|update [name…]
  [--dir] [--dry-run] [--force]` (`typescript-sdk/src/cli/commands/skills/`),
  gcx semantics; install root `<dir>/skills/<slug>/SKILL.md`, recipes nested
  `recipes/<slug>/`, default dir `~/.agents`. `get` prints the raw body
  (human AND agent mode; `-o json/yaml` for structure). Installed files carry
  a `<!-- managed-by: langwatch-skills vX.Y.Z -->` marker — update/uninstall
  only touch managed files, and the marker's VERSION separates a stale
  install (safe to `update`) from local edits (skipped without
  `--force`/`-y`, mirroring each other); install refuses to overwrite
  differing files without `--force`, pointing older-version managed files at
  `update`; uninstall NEVER prompts non-TTY (structured `validation_error`
  telling the caller to pass `-y`).
- Feature map: new `settings.agent-skills` entry claims the 5 leaf commands
  (+ hints); the drift test and catalog-leaf completeness test cover the
  group; `help-tree` annotates `skills get/install` with `# hint:`. The
  Langy capability-catalog coverage test excludes `skills` (local-file
  plumbing, no result card). Catalog skill slugs checked against
  FEATURE_SKILLS: all map `skill:` values are published slugs; `level-up`
  stays unattached by design (meta-skill, no owning feature).
- New recipes in `skills/recipes/` (recipe mold, not FEATURE_SKILLS — they
  are cross-feature workflows, not per-feature skills): `debug-with-langwatch`
  (errored traces → spans → monitor/evaluator scores → root cause; distinct
  trigger surface from `debug-instrumentation`, which keeps instrumentation
  health), `eval-triage` (failing experiment/evaluation investigation),
  `setup-lw` (login/endpoint/project/troubleshooting, composes
  `_shared/cli-setup.mdx` + `api-key-setup.mdx`). Registered in
  `skills/recipes/README.md` + feature-map `meta.recipes`; they flow through
  the existing publish pipeline for free (validated against the real
  remark-based `inlineMdx`).
- Distribution today: `npx skills add langwatch/skills` — stays as alternative.

### 6. Errors (P2) — CLI side DONE
- Three REST error dialects exist server-side (see `handled-error.ts` consumers):
  flattened `{error, message, ...meta, trace:{…}}` (drops `reasons`/`traceUrl`),
  verbatim `serialize()` under `domainError`, and the new framework envelope in
  `langwatch/packages/api/src/errors.ts`. `parseDomainError` reads all three —
  including lifting dialect-1's `trace.traceId`/`trace.traceUrl` out of the nested
  block (they used to land inertly in `meta.trace`) and preserving
  `reasons`/`traceUrl` where dialects 2–3 send them.
- In-flight rename `kind` → `code` (PR #5825): the CLI mirror resolves
  `code ?? kind` everywhere (top level and nested reasons, per
  `specs/features/domain-error-contract.feature`) and emits both
  (`code` + deprecated `kind` alias) in the JSON error document, so old and new
  servers and old and new readers all keep working through the rollout.
- `CliDomainError` carries `suggestions?: string[]` / `docUrl?: string` end-to-end
  (parse → `LangWatchDomainError` → render). Human output is the gcx-style block
  on stderr — `Error:` / `Details:` (code, status, trace id+url, meta, reason
  chain) / `Suggestions:` / `Docs:` — and the JSON envelope carries the same
  fields. Infrastructure errors (`isDomain=false`) still print the sentence alone.
- Until the backend ships `suggestions`, a code-keyed client-side fallback table
  (`typescript-sdk/src/cli/utils/errorSuggestions.ts`, pattern from
  `langwatch/src/features/langy/logic/langyErrorExplainer.ts`) covers the 10 most
  common codes with 1–3 actionable suggestions + a docs URL where one exists.
  Server-sent `suggestions`/`docUrl` ALWAYS win; the fallback only fills gaps.
- **Backend follow-up (not this branch):** dialect-1
  (`app/api/middleware/error-handler.ts`) should stop dropping
  `reasons`/`traceUrl` on the floor; `HandledError.serialize()` gains
  `suggestions`/`docUrl`. The CLI renders both the moment they ship — no further
  client change needed.

### 7–8. Status & ask (P5)
- `lw status` (DONE): gh-status-style "Needs Attention" section renders above
  the resource counts — errored traces (24h), still-running experiments,
  budgets at ≥80% utilization — each fetched in parallel and soft-failing
  independently (human mode notes a failed section dimly; machine output
  carries `attention.errors`). Total resource failure keeps the exit-1
  human-only behavior; machine formats exit 0 with the failures in the
  document. Firing MONITORS were scoped out: `GET /api/monitors` returns
  configuration only — firing state lives in ClickHouse evaluation results and
  is not exposed as an API count (a candidate for a future backend endpoint).
- `lw ask` (NOT BUILT — needs a server endpoint): the investigation found no
  API-key-callable Langy surface. Chat is tRPC-only
  (`langwatch/src/server/api/routers/langy.ts`) behind `protectedProcedure` →
  BetterAuth session cookie (no apiKey plugin configured), plus
  `enforceLangyAccess` (staff / `release_langy_enabled` flag); the internal
  Hono routes (`langy-internal.ts`, `langy-relay.ts`) are worker callbacks
  guarded by `LANGY_INTERNAL_SECRET`, not question endpoints. Building `lw ask`
  against a session-only API would exclude exactly the agent/CI callers it is
  for, so it is split into a server follow-up (spec in Open items).

### 12. Help topics (P5) — DONE
- `help` is registered as a REAL command (`help [topic]`): a command named
  `help` suppresses commander's lazily-created implicit one, so
  `lw help agent-mode` reaches our action while `lw help` / `lw help <command>`
  keep the stock behavior (root help / the named command's help, aliases
  included). Commands are resolved BEFORE topics, and no topic may be named
  after a command — the topic is `agent-mode`, not `agent`, because `agent` is
  a real top-level group. Added to `PLUMBING_COMMANDS` (SDK drift test + status summary)
  and the mirror `EXCLUDED_COMMANDS` in the app-side capabilityCatalog
  coverage test.

### 11. Fast cold start (P6) — DONE
- zod is off the always-loaded program path: the local-prompt-config schema moved
  from `src/cli/types.ts` to `src/cli/types-prompt.ts` (only the lazy-loaded prompt
  commands import it; `types.ts` re-exports the TYPE only, so type-only callers are
  untouched). js-yaml is lazy-loaded in `utils/output.ts` — a memoized dynamic
  `import()` only when `-o yaml` is actually requested (why `printResult` is now
  async; a bare `require` would be invisible to Bun's bundler).
- tsup builds the CLI separately from the library entries: CJS-only, minified, no
  dts, no sourcemaps, `splitting: false` (one `dist/cli/bundle.js`; `onSuccess`
  writes a tiny `dist/cli/index.js` stub that enables Node's compile cache —
  `$TMPDIR/node-compile-cache/<version>-<arch>-<hash>/`, guarded for Node 20/Bun —
  before the bundle is parsed; dynamic imports keep their lazy semantics). chalk
  is also off the boot path (lazy, only for error renders/agent mode).
  Library entries are unchanged (dual format +
  dts + sourcemaps). tsup builds config-array entries concurrently, so `clean` is
  replaced by `rm -rf dist` in the build script — a config-level clean raced the
  other build's output.
- The bun binary build (`scripts/build-cli-binary.ts`) now sets `minify: true`
  (bytecode kept).
- `dist/bin` is excluded from the npm tarball via a `!dist/bin` negation in
  package.json `files`.
- `.github/workflows/cli-binary-publish.yml` builds all five bun targets from one
  ubuntu runner (bun cross-compiles via `--target`) on the `typescript-sdk@*`
  release and attaches binaries + sha256 sidecars to the release.
- Measured (warm, M-series Mac): cold start `node dist/cli/index.js --help`
  ~100ms → ~80ms (CPU profile: zod 0 samples, js-yaml 0 samples; was ~39ms and
  ~8ms respectively); publishable dist 9.6MB → 3.6MB; npm tarball 1.68MB / 887
  files → 0.69MB / 58 files; binary 62.7MB → 61.7MB with --version unchanged at
  ~50ms warm.

## Follow-ups
- Phase 6 (build & binary optimization) landed — see the row-11 notes for the
  measured numbers (~100ms → ~80ms cold start, 9.6MB → 3.6MB dist, 1.68MB →
  0.69MB tarball, 62.7MB → 61.7MB binary). Deliberately DEFERRED to a separate
  change (riskier, touch shared code): the 12MB
  `@opentelemetry/semantic-conventions` prod-dep trim, the `liquidjs` (2.3MB,
  one file) replacement, and the js-yaml vs `yaml` consolidation.

## Open items
- [x] ~~Verify npm availability of the `lw` package name before publish~~ — the
  `lw` PACKAGE name is taken (abandoned 2022 utility, v0.1.1) but declares no
  `bin`, so shipping `bin: { "lw": …, "langwatch": … }` from the existing
  `langwatch` package is safe (done — `typescript-sdk/package.json`; help text
  reflects the invoked name and notes the alias). No new package needed.
- [ ] `lw ask "<question>"` — server endpoint needed first (P5 verdict: no
  API-key-callable Langy surface exists). Proposed shape: one Hono route,
  e.g. `langwatch/src/server/routes/langy.ts` at `POST /api/langy/chat`, using
  the existing API-key middleware pattern from `routes/auth.ts` /
  `health-checks.ts` (resolve `X-Auth-Token` → owning user + project via the
  TokenResolver), then mirror `langyTurnProcedure`: `hasLangyAccess` +
  `checkLangyMessageRateLimit`, and
  `getApp().langy.turns.startConversationTurn({ projectId, requestId, session:
  { user: { id } }, messages, ... })` — the app layer already anticipates this
  caller (`server/app-layer/langy/langyApiKey.ts`: "if/when Langy is exposed to
  programmatic (API-key) callers…"). Reply delivery, simplest first: poll the
  durable `messages` read model until the fold leaves active/running and return
  the final assistant text (optionally SSE from the Redis token buffer exactly
  as `onTurnStream` does). The CLI side is then small: `lw ask "<question>"
  [--json]`, help text steering agents to deterministic commands first.
- [x] ~~Decide whether `lw ask` needs a server endpoint (scope check in P5)~~ —
  yes, see above.
- [x] ~~P5 docs: `docs/skills/directory.mdx` + `docs/integration/cli.mdx`~~ —
  done: `langwatch skills install` is the primary install path in the
  directory (with the 3 new recipe accordions), `cli.mdx` gained the
  Agent usage section (agent mode, output contract, structured errors,
  discovery, skills, daemon note). The `lw` rename stays out of the docs until
  the naming/publish step.
