# LangWatch

LLM Ops platform: evaluation, observability and optimisation of AI agents. One
pnpm workspace (TypeScript), plus Go and Python services.

<!-- Keep this file for what nearly every session needs; target under 10 KB.
Area guidance lives in .claude/rules/*.md (path-scoped), procedures in
.claude/skills/, reference in dev/docs/. Link, don't @-import. -->

## Where the truth lives

In this order. When they disagree, the higher one wins and the lower one is the
defect.

1. **The linters.** `pnpm lint` (oxlint + the `langwatch` plugin, every rule at
   `error`) and `pnpm lint:architecture` (whole-tree policies). Every finding
   carries its own fix: do what it says. Never game a rule by renaming.
2. **`dev/docs/ARCHITECTURE.md`**, the architecture record. Read the relevant
   section before composing a process, writing a module or citing a shape.
   §15 lists deleted spellings (writing one is a defect); §16 maps target
   names that have not landed yet to today's names.
3. **`specs/` and `modules/<name>/specs/`**: feature files are the
   requirements. If no scenario covers your task, write one first, error paths
   included.

Operating discipline (what you may run and edit, git in a shared checkout,
secrets, cost) is canonical in `.claude/skills/core/repository-rules.md`; tests
in `.claude/skills/core/testing-rules.md`. Read them before running checks or
touching git.

## Layout

```
apps/           ui (Vite SPA :5560) · api (tRPC+REST+SSE :6560) · worker (queues, projections,
                subscribers) · tasks (migrations/backfills, run before serve) · server (npx CLI)
                · scenario-child. An app is main.ts + config.ts; no product code.
modules/<name>/ one feature: contract/ · process/ · browser/ · browser-kit/ (+ specs/, adrs/)
modules/catalogue.json   the one map of subject -> owning module
enterprise/modules/      same shape, entitlement-gated at runtime
packages/       framework only; feature code here is a defect
services/       aigateway, nlpgo, langyagent (Go) · langevals (Python)
sdks/           python · typescript (the published `langwatch` SDK, not the product) · go
specs/  tools/ (thuishaven = haven)  mcp/typescript/  docs/ (public docs site)
```

ui, api and worker always run together: a stack missing the worker serves pages
and silently processes no jobs.

Inside a module: `process/src/` holds `<name>.server.ts`, `app/`, `services/`,
`repositories/`, `channels/`, `eventing/`, `transport/`, `rules/`, `tasks/`,
`migrations/`; `browser/src/` holds `model/` → `behavior/` → `ui/elements|blocks|sections`.
The filename grammar is `packages/oxlint-rules/grammar/feature-layout-policy.mjs`.
Path-scoped rules in `.claude/rules/` load the details when you open those files.

## Rules that hold everywhere

1. **A module is an isolated microservice.** Other code sees only its contract
   and calls its `*Api` token. Reaching into another module's services,
   repositories, channels, tables or browser package is a violation even when
   the import resolves.
2. **A repository belongs to one module**, takes only its own store, and is
   called only by that module's services. Owning a table means owning every
   query against it.
3. **Behaviour lives in `services/`**: repository = owned state, channel =
   messages to anything the module doesn't own, service = behaviour over both.
   Transports, repositories, channels and module classes stay thin.
4. **Comments: five lines maximum**, delimiters included (lint error at six,
   unsuppressible). Longer reasoning goes in an ADR (`dev/docs/adr/`) or spec
   with a one-line link. Delete comments that restate the code.
5. **Named parameters** (`fn({ a, b })`), top-level `import`/`import type` only
   (no inline `import()`), Zod + `infer` instead of duplicated TS types.

## Verify every change

After each change, scoped to the paths you touched:

```bash
pnpm exec oxfmt --write --disable-nested-config <paths>
pnpm exec oxlint --quiet --type-aware --config .oxlintrc.jsonc <paths>
pnpm lint:changed                                             # or: your changes and dependents, cached
VITEST_MAX_WORKERS=2 pnpm --filter <package> test <paths>   # never npx vitest; no `--`
tsc --noEmit --ignoreConfig <file>                            # one file while iterating
```

At the end of the task, once: `pnpm --filter <package> typecheck` for each
package touched, and `pnpm lint:architecture --policies <ids>` for whole-tree
policies you may have affected (`--list-policies` lists them). Spec binding:
`pnpm --filter @langwatch/architecture-enforcer check:feature-parity`; read the
verdict banner.

Whole-repo `pnpm typecheck`, `pnpm lint` and `pnpm format` hold several GiB and
every core. Run them only when the task is to finish and ship, never as a lane
working under the coordinator, and never `pnpm format` while others share the
checkout. Heavy commands queue through haven's machine-wide gate (a PreToolUse
hook `haven up` installs); a queued run says so on stderr. That is a wait, not a
hang. Don't bypass it with a raw `tsc -b`.

If the workspace is red from unrelated work, prove your slice and report the
remaining diagnostics exactly. Don't call a blocked check green.

## Commands

```bash
pnpm install                        # root only; one lockfile. Narrow: --filter "<pkg>..."
pnpm start:prepare:files            # generated files (Prisma client, etc.); fixes "Cannot find module"
pnpm generate:modules               # after editing modules/catalogue.json
pnpm sync:references                # after adding/removing a workspace package
pnpm test:affected / typecheck:affected   # Nx: only packages this change reached, cached
pnpm prisma:migrate / clickhouse:migrate  # run via @langwatch/tasks
make go-lint-changed                # Go: lints your uncommitted edits (never raw golangci-lint)
```

Nx (ADR-150) sits beside the root scripts, not in front of them: prefer the
`pnpm` scripts above; the Nx plugin's skills cover `nx` itself.

## Dev stack

`make haven up` starts this worktree's stack at
`app.<slug>.langwatch.localhost` (UI; `/api` for the API). `haven status`,
`haven logs api|ui|go -t`; add `--agent` when driving haven as an agent. Plain
`pnpm dev` also works (ports derive from `PORT`, default 5560). Full reference,
including the no-container setup: `dev/docs/LOCAL_STACK.md`; when it won't come
up, the `haven-setup` skill.

`.env` lives at the workspace root. **Never read `.env` or print a secret**;
values resolve through `@langwatch/secrets` (ADR-132) and `haven env` masks
them. Module code never reads `process.env`.

## Git and GitHub

- Other changes in the checkout belong to someone else. Stage explicit paths,
  never `git add -A`/`.`, never `git stash`; check `git diff --cached --stat`
  before committing. Don't push or open a PR unless asked.
- British English in prose; no em dashes; no attribution lines or agent names in
  commits, PRs or specs. Never name a customer: the repo is public.
- Commit messages are Conventional Commits (`feat(scope): …`, `fix: …`).
- Branches: `issue123/slug` for issues, `feat/slug` for features.
- Worktrees go in `.worktrees/<branch-with-slash-as-hyphen>` via
  `make worktree <issue|name>`; never `.claude/worktrees/`, a sibling checkout
  or `/tmp`. More in `dev/docs/best_practices/git.md`.
- `gh pr edit --body` → `gh api repos/OWNER/REPO/pulls/N -X PATCH -f body="…"`.
- `gh api graphql`: inline values in the query; `-f`/`-F` break on multiline.
- Don't trust `gh pr checks` alone (it dedups by name); use
  `gh run list --branch <branch>`.

## Other traps

- **Subagents:** every spawn names model, effort and context size plus one clause
  why; routing table in `.claude/coordinator/COORDINATOR.md` §3.
- **Dogfooding:** `langwatch login`/`instrument` rewrite machine-global config.
  First export `LANGWATCH_CLI_CONFIG`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME`
  under `<worktree>/.claude/tmp/dogfood/` (`dev/docs/best_practices/dogfooding-isolation.md`).
  Test agent-usage features in a real interactive session in a sub-tmux, not
  `claude -p`, and check the data landed in the product.
- **Local binaries** go in `.bin/<name>/<name>` (ignored).
- **rtk** is optional here. Check `command -v rtk` once; if present, prefix each
  command in a chain (`rtk git status`, `rtk pnpm …`); if absent, run unprefixed.
  `rtk --help` lists its filters.

## References

`dev/docs/ARCHITECTURE.md` · `dev/docs/CODING_STANDARDS.md` ·
`dev/docs/TESTING_PHILOSOPHY.md` · `dev/docs/lint-rules.md` (generated) ·
`dev/docs/best_practices/` · `dev/docs/adr/` · `dev/docs/LOCAL_STACK.md`
