---
name: haven-seed
description: "Fill a haven stack with seeded data and read its logins with `haven seed`, including the auto-seed that `haven up` runs on an empty stack. Use when someone says 'haven seed', 'seed the stack', 'seed data', 'auto-seed', 'haven up --no-seed', 'who can I log in as', 'seeded logins', 'fake credentials', 'tiny small medium large seed', 'seed status', 'live load', 'seed an org on a licence', or 'seedgen'."
user-invocable: true
argument-hint: "[status] [--size tiny|small|medium|large] [--persona all] [--json] [--reveal]"
---

# haven seed

`haven seed` generates seeded data into this stack (seedgen, `tools/seedgen`), then prints the
logins and credentials. Names are invented; same `--seed` gives the same content.

## Auto-seed on `haven up`

On a stack that was never seeded, `haven up` runs the `tiny` tier with all four personas
after the identity seed. It waits about a minute, then reports ready and lets the seed finish
in the background; `haven seed status` and `haven status` show progress. Skip it with
`haven up --no-seed` or `HAVEN_AUTO_SEED=0`. A failure is one line and never stops the boot.

## Commands

```bash
haven seed                       # small tier, then the logins (masked)
haven seed status                # the last run's state and latest log lines
haven seed --size tiny --persona startup
haven seed --dry-run             # counts, rows, bytes, duration; writes nothing
haven seed --json --reveal       # logins and credentials as one object, unmasked
haven seed --live                # a gentle live load into the last seed's orgs
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
  1Password. They rotate only on `haven destroy`. A browser signs in with `--as admin` or
  `--as <email>` (`haven-browser`, `haven-auth`); nobody types the password.
- The stack home's Seed panel runs the same command for a running stack.

## Old presets and the neighbours

- `haven db seed <preset>` and `haven db reset <preset>` stay (`haven-db`): `demo` runs
  `haven seed --size tiny --persona startup`; `bare`, `onboarding`, `post-onboarding` are
  storage-seed switches.
- The seed guard refuses (exit 2) when a database URL the seed would connect to points
  anywhere but local dev, so it cannot seed a real database named by `.env`.
- Pointers only: the generator is `tools/seedgen`, the design is `dev/docs/plans/seed-2026-10-09.md`,
  and upgrade rehearsals that seed old releases are `upgradelab` (see the `upgrade` skill).
