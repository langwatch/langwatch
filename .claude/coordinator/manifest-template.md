# Manifest template

Copy to `.claude/manifests/<task-id>.md`. Written by the coordinator **before**
the lane starts. It is a contract: the lane may not widen it, and the coordinator
changes it only deliberately, in place, with the lane stopped.

A manifest that cannot name its owned paths is not ready to be a task. Split it
until it can.

---

```markdown
# Manifest: <task-id>

Objective: <one sentence, outcome-shaped>
Owner: <lane name, or `unassigned`>
Model: <opus | fable | sonnet | haiku>   <one clause saying why>
Budget: <n> tool calls or <n> minutes, whichever comes first
Handoff: .claude/handoffs/<task-id>.md

## Owned paths

<Directories and files this lane may edit. Explicit - never "everything under
modules except X", never a regex, never "all dirty files". A lane resolves this
list literally.

  modules/trace/contract/src/**
  modules/trace/server/src/transport/**
  modules/trace/server/src/__tests__/**

If two lanes will run at once, check by eye that their lists cannot intersect.
That check is the coordinator's single most valuable minute.>

## Shared paths - stop and request

<Files this lane will plausibly need and must not edit. Name them here rather
than relying on the lane to recognise one, and say who owns them.

  apps/api/src/app-rest/api-rest.doors.ts              coordinator
  apps/api/src/app/api-production.composition.ts       coordinator
  apps/ui/src/features/catalogue.json                  coordinator
  packages/architecture-enforcer/src/*-baseline.json       coordinator

The lane writes the exact lines it needs into its handoff, section 10, and
carries on with whatever else it can do.>

## Read-only reference paths

<Where to look, so the lane does not go exploring. Exemplars, the module it is
copying, the origin/main router it must stay wire-compatible with.

  modules/annotation/**                     the reference shape - copy this
  modules/organization/server/src/transport/**   the transport exemplar

Naming these is worth many turns: a lane with no exemplar greps for one.>

## Target shape

<What the result looks like when it is right. A file layout, a signature, a list
of routes - concrete enough to compare against. Link the reference rather than
restating it:

  Follow `.claude/skills/module/references/convert.md`. End shape:
  defineModule("trace").withRepositories(...).withApp(TraceApp).withTransports(...)

If this section needs more than about fifteen lines, the guidance belongs in a
skill reference and this section should link to it.>

## Invariants

<What must not change. The public wire is almost always one of them:

  - Route paths, procedure names, inputs, outputs, statuses and permissions stay
    as they are on origin/main. Record any unavoidable difference with a reason.
  - No new dependency without declaring it in package.json first.
  - The branch boots after every landed step.>

## Checks

<Exactly what this lane runs, and nothing wider. These are the checks the handoff
reports against.

  pnpm --filter @langwatch/trace-server test:unit src/transport
  pnpm typecheck:one modules/trace/server        (once, at the end)

Follows `.claude/skills/core/testing-rules.md`. Never a whole-tree check.>

## Stop conditions

<When to stop and write the handoff, beyond finishing. The standard set:

  - a shared path is needed
  - a check fails in a way you cannot fix within budget
  - the budget is reached
  - this manifest turns out to be wrong

Add any task-specific ones here.>

## Completion criteria

<Checkable claims, not a feeling. The lane is done when every line here is true:

  - 6 trace-export routes answer on the paths they answer on origin/main
  - the transport mount test passes
  - baseline rows trace|nested-transport and trace|legacy-transport-runtime can
    be dropped
  - typecheck:one is clean for modules/trace/server

If a criterion is not checkable, rewrite it until it is.>
```
