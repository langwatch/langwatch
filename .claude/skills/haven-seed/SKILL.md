---
name: haven-seed
description: "Fill a haven stack with seeded data and read its logins with `haven db seed`, including the auto-seed that `haven up` runs on an empty stack. Use when someone says 'haven seed', 'haven db seed', 'seed the stack', 'seed data', 'auto-seed', 'haven up --no-seed', 'who can I log in as', 'seeded logins', 'fake credentials', 'tiny small medium large seed', 'seed status', 'haven db status', 'haven db logins', 'live load', 'seed an org on a licence', or 'seedgen'."
user-invocable: true
argument-hint: "[preset] [--size tiny|small|medium|large] [--persona all] [--json] [--reveal]"
---

# haven db seed

`haven db seed` generates seeded data into this stack (seedgen, `tools/seedgen`), then prints the
logins and credentials. Names are invented; same `--seed` gives the same content.

## Auto-seed on `haven up`

On a stack that was never seeded, `haven up` runs the `tiny` tier with all four personas
after the identity seed. It waits about a minute, then reports ready and lets the seed finish
in the background; `haven db status` and `haven status` show progress. Skip it with
`haven up --no-seed` or `HAVEN_AUTO_SEED=0`. A failure is one line and never stops the boot.

## Commands

```bash
haven db seed                       # small tier, then the logins (masked)
haven db status                # the last run's state and latest log lines
haven db seed --size tiny --persona startup
haven db seed --dry-run             # counts, rows, bytes, duration; writes nothing
haven db seed --json --reveal       # logins and credentials as one object, unmasked
haven db seed --live                # a gentle live load into the last seed's orgs
```

Flags: `--size tiny|small|medium|large`, `--spans <n>` (1 to 2000000), `--days <d>`,
`--persona startup,enterprise,gateway,agent-eval|all`, `--private <n>`, `--seed <s>`,
`--anchor <rfc3339>`, `--age <n>d` (history ends n days ago, to test retention),
`--conversations <n>`, `--turns <n>`, `--shape saas|sh-licensed|sh-free`,
`--org name=..,plan=free|licence,users=N[,persona=..][,owner=EMAIL][,admin=no]` (repeatable),
`--into <org-id>/<project-id>` (telemetry only, into an existing project), `--live`,
`--dry-run`, `--json`, `--reveal`.

Exit codes: 0 done, 1 a check failed, 2 refused before writing, 4 stalled.

## Logins and credentials

- The end of a seed prints the admin login, org, team and project slugs, the project API key,
  the personal access token, the SCIM token and the instance admin key. They are masked;
  `--reveal` shows them, `--json` gives one object. Never paste revealed output.
- Credentials are made up by haven per stack and live in haven's state; no real key and no
  1Password. They rotate only on `haven down --destroy`. A browser signs in with `haven browser login --as admin` or
  `--as <email>` (`haven-browser`, `haven-auth`); nobody types the password.
- `haven db logins` prints the seeded logins again, masked unless `--reveal`.
- The stack home's Seed panel runs the same command for a running stack.

## Presets and the neighbours

- `haven db seed <preset>` and `haven db reset <preset>` take the presets (`haven-db`): `demo` runs
  `haven db seed --size tiny --persona startup`; `bare`, `onboarding`, `post-onboarding` are
  storage-seed switches.
- GitHub pull-request fixture (no App): `haven db seed demo` maps PRs #101 (open) and #102 (merged) on
  `langwatch-seed/checkout` to the local dev org; `haven sim telemetry send --preset claude-code-events` gives a session on #101's branch.
- The seed guard refuses (exit 2) when a database URL the seed would connect to points
  anywhere but local dev, so it cannot seed a real database named by `.env`.
- Pointers only: the generator is `tools/seedgen`, the design is `dev/docs/plans/seed-2026-10-09.md`,
  and upgrade rehearsals that seed old releases are `upgradelab` (see the `upgrade` skill).
