# Langy worker assets: AGENTS.md + embedded skills

Everything in this directory ships INSIDE the manager binary via `//go:embed`
(`assets.go`), so spawning a worker depends on nothing outside the process —
no init container, no seeded volume. This README covers what lives here, how
it reaches a worker, and the invariants tests pin. The public-skill side of
the story is `skills/README.md` at the repo root.

## What lives here

| Path | What it is |
|---|---|
| `AGENTS.md` | Langy's system-prompt rules doc, rendered into each worker's `$HOME/AGENTS.md`. Identical in dev and prod (no Docker overlay). |
| `skills/github/` | Local-build mirror of the Langy-only GitHub skill compiled from root `skills/github/SKILL.mdx`. |
| `assets.go` / `assets_test.go` | The embed + materialization code and its pins. |

## Two kinds of skills, one directory at build time

- **All production skills** (analytics, scenarios, tracing, GitHub, …) are authored in the
  repo-root `skills/` workspace and compiled to `skills/_compiled/native/`.
  `Dockerfile.langyagent` COPYs
  `skills/_compiled/native/` into this package's `skills/` dir **before
  `go build`**, so the production binary embeds the full set. `go:embed`
  cannot reach above the package dir — that is why the overlay copies files
  in rather than the directive reaching out.
- **Langy-only skills** (`github/` today) are selected with
  `NATIVE_ONLY_SKILLS` rather than `FEATURE_SKILLS`.
  They assume the worker's provisioned environment (short-lived `GH_TOKEN`,
  bot git identity, platform-rendered activity cards), which makes them
  useless or misleading outside the product — so they must never reach the
  public [langwatch/skills](https://github.com/langwatch/skills) repo.
  The checked-in copy here makes local Go builds valid and is pinned to the
  root-compiled output by `skills/_tests/native-skills.test.ts`.

The checked-in tree (github/ only) is the dev/test subset; it also keeps the
`//go:embed skills` directive valid, which would fail on an empty directory.
A locally built manager therefore has ONLY the github skill unless you copy
`skills/_compiled/native/` in yourself.

## How the assets reach a worker

1. `workerpool.New` reads `AGENTS.md` from the embedded FS once
   (`assets.AgentsTemplate`) and materializes the embedded `skills/` tree to
   the shared workspace on disk (`assets.MaterializeSkills`) — root-owned,
   world-readable (0755/0644), so every per-conversation UID can read but not
   modify it.
2. Per spawn, `opencode.Provision` writes the worker's `$HOME/AGENTS.md` with
   `${LANGWATCH_ENDPOINT}` substituted, and symlinks
   `$HOME/.config/opencode/skills` → the shared skills dir. That config path
   is where opencode discovers global skills — each `<name>/SKILL.md` becomes
   an invokable skill.
3. opencode reads `$HOME/AGENTS.md` as the project rules doc and surfaces the
   discovered skills to the model.

## Editing AGENTS.md — the traps

- **`${LANGWATCH_ENDPOINT}` is substituted with `strings.ReplaceAll`** — every
  occurrence, including any that appear in explanatory prose. Never write a
  sentence that talks ABOUT the literal placeholder (it would render as
  gibberish once the real URL is substituted in); only use the token where the
  resolved URL itself should appear. `assets_test.go` pins that the template
  keeps at least one occurrence.
- **Rule numbers are load-bearing.** `skills/github/SKILL.md` says "see global
  rule 14" and `platform/app/src/features/langy/logic/langyPlan.ts` documents
  itself against "AGENTS.md rule 14". Do not renumber the absolute rules;
  append new ones at the end, and grep for `rule <n>` before moving anything.
- **The routing table must stay true.** Every skill it names must exist in
  `skills/_compiled/native/` or in this directory, and every CLI invocation it
  shows must exist in the `langwatch` CLI version pinned by
  `LANGWATCH_CLI_VERSION` in `Dockerfile.langyagent`
  (`sdks/typescript/src/cli/program.ts` is the grammar). A row promising a
  command that does not exist teaches the model to hallucinate.
- **URLs must be real routes.** The UI is project-scoped
  (`/<projectSlug>/...`); the worker does not know the slug, so AGENTS.md uses
  the `/@project/<path>` redirect (`platform/app/src/pages/@project/[...path]`)
  and prefers the `platformUrl` field the REST API returns on resources.

After any change run:

```bash
go test ./services/langyagent/...
```

## Adding a skill

- **Public** (customers get it too): author it in the repo-root `skills/`
  workspace — see `skills/README.md`. It flows into the Langy image through
  the compile + Docker overlay automatically.
- **Langy-only** (depends on the provisioned worker environment): author it in
  repo-root `skills/<name>/SKILL.mdx`, add it to `NATIVE_ONLY_SKILLS`, regenerate
  the native output, and mirror it here for local Go builds. Add a row to the
  AGENTS.md routing table so the model routes to it.
