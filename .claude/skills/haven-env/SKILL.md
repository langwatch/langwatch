---
name: haven-env
description: "Print a haven stack's resolved environment without leaking a secret, and know where each value comes from: `haven env`, `--reveal`, overlay versus the root .env, made-up stack credentials, Stripe key choice, the knobs in `haven help env`, `haven limits`. Use when someone says 'haven env', 'what env does the stack use', 'print the environment safely', 'env reveal', 'the root .env beats the overlay', 'my .env change did nothing', 'which keys are secret', 'LANGWATCH_SLUG', 'machine limits', 'haven limits', 'redis maxmemory', or 'where does this variable come from'."
user-invocable: true
argument-hint: "[--reveal] | limits [set <name> <value> | unset <name>]"
---

# haven env

```bash
haven env                         # this stack's resolved environment, every secret masked
haven env --json                  # machine-readable
eval "$(haven env --reveal)"      # real values into your shell; never paste or print this
haven help env                    # every knob and where it resolves from
```

## Masking

- `haven env` prints `<secret:masked>` for every secret; connection strings keep their shape and
  lose the credential. Safe to paste into an issue.
- Which keys are secret: every `Secret.load("ID")` handle found in source, plus any name that looks
  like a credential (`tools/thuishaven/domain/secretkeys.go`).
- `--reveal` (also on `haven status` and `haven seed`) unmasks. Never read `.env` to find a value,
  never print a revealed value, never write one to a file.

## Precedence

- The workspace `.env` beats haven's overlay: a value you set there wins, haven fills only what
  is unset. The root `.env` is shared by every worktree, so pin nothing run-specific in it.
- Per-run knobs read the process environment only: `LANGWATCH_SLUG`, `HAVEN_BASELINE`,
  `LANGWATCH_SEED`, `HAVEN_AGENT`, `NO_COLOR` and the other names `haven help env` lists.
  `HAVEN_TRUSTED_REPO_ROOT` and `HAVEN_UNTRUSTED_CHECKOUT` are set by haven and never read from `.env`.
- Machine limits: environment, then `.env`, then the settings file `haven limits set` writes, then default.
- Only `haven down` followed by `haven up` reloads a changed `.env`; `haven restart` does not.

## Made-up credentials

- Per stack, made up by haven: `NEXTAUTH_SECRET`, `CREDENTIALS_SECRET`,
  `LANGWATCH_INSTANCE_ADMIN_API_KEY`, `HAVEN_SEED_SCIM_TOKEN`. They live in haven's own state, survive
  down/up and rotate only on `haven destroy`. No real key, no 1Password.
- Stripe is paymentsim on every stack unless `.env` sets a Stripe key; `haven up` prints
  `Stripe: paymentsim` or `Stripe: your key from .env` (`paymentsim` skill).
- Logins and tokens are printed by `haven seed` (`haven-seed`).

## Machine limits

```bash
haven limits                          # RAM and CPU, each limit's value, source and knob
haven limits set redis-maxmemory-mb 2048
haven limits unset redis-maxmemory-mb
```

Limits: `clickhouse-memory-mb`, `observability-memory-mb`, `redis-maxmemory-mb`, `colima-cpus`,
`colima-memory-gib`, `test-workers`, `instant-eval-mock-judge`. `haven limits` also says when each
change applies (next `haven up`, a restart, or the next test run). Changing a machine limit
affects every stack on the machine: ask before setting one.
