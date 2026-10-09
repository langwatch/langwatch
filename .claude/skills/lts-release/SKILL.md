---
name: lts-release
description: "The twice-yearly procedure to name a long-term-support (LTS) release and move the LTS floor: which release, what `packages/upgrade/releases/lts-floor.json` becomes (the PREVIOUS LTS), which contract steps the move makes eligible, which docs and skills to update, which checks to run, and what never happens (no backport, no patch branch). Use when someone says 'name the LTS', 'cut an LTS', 'April LTS', 'October LTS', 'move the floor', 'bump the LTS floor', 'lts-floor.json', 'which LTS is next', 'can this contract ship yet', 'patch the LTS' or 'backport a fix'."
user-invocable: true
argument-hint: "<the release Alex named as LTS, and the naming date>"
---

# Naming an LTS and moving the floor

Ruling (Alex, 2026-10-09, LTS-SCHEDULE), in `dev/docs/ARCHITECTURE.md` §7 after "Upgrades run on
deploy"; ADR-173 D8 and D10; ADR-155. How the floor is enforced: the `upgrade` skill. Public page:
`docs/self-hosting/releases.mdx`.

## The rules

- An LTS is named every **April** and **October**. The first is `3.20.1` (named 2026-10-06); the
  next is April 2027.
- An LTS is an **upgrade stop**, not a maintained branch. Only the latest release gets fixes; no LTS
  or older line is ever patched.
- Naming a new LTS moves the floor to the **previous** LTS. An installation on the newest LTS always
  goes straight to head; a stale one stops at most once a year; dead schema lives about 12 months.
- Cloud waits for the same floor (D8). A lane never names an LTS or moves the floor on its own:
  Alex names the release.

```
LTS named:    3.20.1 (Oct 2026)   A (Apr 2027)   B (Oct 2027)   C (Apr 2028)
floor after:  3.20.1              3.20.1         A              B
```

April 2027 leaves `lts-floor.json` unchanged (the previous LTS is `3.20.1`). The first move is
October 2027.

## Procedure

1. **Confirm the release.** Alex names it. It must have a stamped manifest
   (`packages/upgrade/releases/<release>.json`) and a published image `langwatch/langwatch:<release>`.
2. **Move the floor** to the LTS named before this one, never further:
   `packages/upgrade/releases/lts-floor.json` → `{ "release": "<previous LTS>", "namedAt": "<today>" }`.
   Skip this step when the previous LTS already is the floor.
3. **Update the public table** in `docs/self-hosting/releases.mdx`: the new LTS's row (release,
   month) and the floor column, plus the worked example if its months are now in the past.
4. **Update the literal floor** where teaching surfaces name it: `git grep -n "<old floor>" --
   .claude/skills dev/docs/runbooks docs/self-hosting` (today: `migration`, `postgres-migration`,
   `clickhouse-migration` skills, `dev/docs/runbooks/upgrade-on-deploy.md`). ADRs and plans stay as
   written. The scanner tests read `lts-floor.json` themselves.
5. **List what became eligible** (below) in the handoff for the coordinator to schedule.

## What the move makes eligible

- **Contract steps** whose note `-- contract: retired in <release>` names a release at or below the
  new floor: the `retirement-note-above-floor` scanner rule
  (`packages/{prisma-client,clickhouse-migrations}/src/__tests__/migration-safety.rules.ts`) now
  admits them. Find the parked ones in handoffs and ledgers ("waits for the floor"). Each ships as a
  **new** migration in a later release, never an edit; a drop that needs a backfill finished first
  carries `-- after: <step id>`.
- **Upcast originals**: a renamed event's or aggregate's stored originals may be deleted by a
  contract step (record §9).
- Rollback never reopens a step retired below the floor (`packages/upgrade/src/serving-roster/rollback.ts`).

## Checks

| Check | Command |
| --- | --- |
| Floor parses, plan and refusal | `VITEST_MAX_WORKERS=2 pnpm --filter @langwatch/upgrade test` |
| Scanners against the new floor | `VITEST_MAX_WORKERS=2 pnpm --filter @langwatch/prisma-client test src/__tests__/migration-safety.unit.test.ts`, the same for `@langwatch/clickhouse-migrations` |
| The floor image boots on head's schema | dispatch `.github/workflows/migration-compat.yml` (its `lts-floor` job reads `lts-floor.json`) |
| An installation on the old floor is refused by name | `pnpm task upgrade plan` against a store on the old floor: refusal naming the new floor |
| Docs build and links | the docs site checks on the PR |

## Never

- A backport, a patch release or a hotfix branch for an LTS or any older release. Fixes ship at head.
- Move the floor above the previous LTS, backwards, or between namings.
- Edit a released manifest or a merged migration to fit the new floor.
