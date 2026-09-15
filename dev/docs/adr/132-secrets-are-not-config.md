# ADR-132: Secrets are not configuration, and they arrive through a source chain

**Date:** 2026-09-07

**Status:** Accepted

**Behavioural contract:**
[Secret sources](../../../packages/secrets/specs/secret-sources.feature),
[the lint rule](../../../specs/tooling/lint-secrets-through-source.feature)

**Related:** [ADR-104: runtime environment configuration](./104-runtime-environment-configuration.md),
[ADR-102: runtime composition roots](./102-runtime-composition-roots.md)

## Context

ADR-104 gave every runtime one typed environment boundary: a composition root
parses the variables it owns with Zod and hands features semantic values. It
made the boundary typed. It did not make it *classified*. To that seam,
`OPENAI_API_KEY` and `BASE_HOST` are the same kind of thing — a string in a
record — so nothing in the repository could answer "is this value safe to
print", and every guard that wanted to answer it grew its own list.

The environment is also one flat namespace holding at least three different
kinds of value, and treating it as two ("secrets and the rest") misses the one
that actually leaks:

```
  DATABASE_URL = postgresql://app:hunter2@db.internal:5432/langwatch?sslmode=require
                 └──────────┘ └───────┘ └──────────────────────────┘ └────────────┘
                   scheme      CREDENTIAL   host, port and path         query
                              redact this   keep this: a log line needs to say
                                            WHICH server was unreachable
```

Redacting that value wholesale costs the operator the one fact the log line
existed to carry. Printing it leaks the password. It needs structural
redaction, which needs a class, which needs a registry.

Locally the source of every secret is the workspace-root `.env`, a plain file
holding live provider keys on every laptop and in every worktree, refreshed by
hand and rotated by nobody. Two `ensure-*.sh` scripts generate four values into
it on first run; a third replaces the rotating AWS SSO lines. In production the
posture is already correct and deliberately dumb: `charts/langwatch/templates/**`
wires every secret through `secretKeyRef`, and the pod holds no vault client.

## Decision

### The classification is data, in one file, read by both languages

`packages/secrets/keys.json` names every key that carries a credential and its
class. TypeScript parses it with Zod; haven reads the same file in Go. There is
no second list and no generated Go source to keep in step — a key added once is
masked everywhere.

| Class | What it is | Count | In a log line |
| --- | --- | --- | --- |
| `secret` | A rotating credential | 29 | `[redacted]` |
| `composite` | Shape and credential in one string | 10 | scheme, host, port and path kept; userinfo and query stripped |
| `pointer` | Names a credential on disk | 1 | verbatim — the file it names is the vault's problem |
| `config` | Everything else | ~90 | verbatim |

`config` is the class nobody has to think about, and keeping it large is the
point: the ~90 keys that are deployment shape stay as free to print, log and
paste into an issue as they are today.

### One port, ordered adapters, resolved before the Zod parse

```
        options.source (process.env + the .env the app already loaded)
                 │
                 ▼
   ┌─────────────────────────────────────────────────────────┐
   │  ChainedSecretSource   — first answer wins, by key      │
   │                                                         │
   │   EnvSecretSource ──► OnePasswordSecretSource ──► Refuse│
   │   (always)            (dev only, opt-in)         (names │
   │                                                   what's│
   │                                                   missing)
   └─────────────────────────────────────────────────────────┘
                 │  new FROZEN record; process.env is NOT mutated
                 ▼
        resolveApiConfig / resolveWorkerConfig / resolveTasksConfig
                 │  Zod, exactly as ADR-104 describes it
                 ▼
        every feature, seeing plain values and knowing nothing
```

`SecretSource` has one method, `resolve({ keys })`. It is batched, not per-key,
so a source backed by a subprocess pays once per boot instead of once per
variable. Absence is a missing map entry; a throw means the *source* failed
(signed out, unreachable), which needs different words than "that secret does
not exist".

Resolution happens **before** the Zod parse, so nothing downstream changes: a
feature still receives a plain string and still cannot tell where it came from.
The resolved record is new and frozen, so a stray `process.env.OPENAI_API_KEY`
read stays as broken as the lint rule says it is.

### 1Password is opt-in, and never constructed in production

`OnePasswordSecretSource` resolves an `op://vault/item/field` value it finds in
the environment, and — when `LANGWATCH_SECRETS_VAULT` is set — looks a missing
key up at `op://<vault>/langwatch-<profile>/<KEY>`. It shells out to the `op`
CLI through a `ProcessRunnerPort`, so a test injects a fake and no test needs
the binary.

The CLI rather than the SDK: the SDK needs a service-account token, itself a
long-lived secret you would then have to store on the laptop — circular — and
it cannot use biometric unlock.

When `NODE_ENV=production` the source is not constructed at all. A pod never
shells out, holds no vault session, and gains no failure mode. Teams wanting
1Password upstream get it through external-secrets or the 1Password Operator
syncing *into* a `Secret`, outside the application and invisible to it.

### The profile is explicit, never the worktree name

Alex's ruling, and the right one. A worktree slug is a directory name, and this
repository makes worktrees constantly. A lookup keyed on it would miss on a
rename and fall silently through the chain — the worst failure mode for a
secret is not a wrong value but an *absent* one at boot, three directories from
the cause. It also encodes the wrong cardinality: secrets are per-developer,
occasionally per-environment, essentially never per-worktree; five worktrees
would mean five items holding the same `OPENAI_API_KEY` and five places to
rotate it.

`LANGWATCH_SECRETS_PROFILE` defaults to `dev`, so every worktree resolves to
`langwatch-dev`. Anyone who genuinely wants a per-worktree secret sets the
profile there — explicit, visible in `haven env`, and a typo produces a named
refusal rather than a silent miss.

### A first launch writes into the vault, and migration is an explicit act

Two behaviours ride on the vault being configured, and both write, so both are
gated on an explicit opt-in (`LANGWATCH_SECRETS_GENERATE`) rather than on the
vault alone. Writing to someone's vault as a side effect of starting a stack
would be a surprise.

`DevGeneratedSecretSource` mints the four values the two `ensure-*.sh` scripts
would have written into `.env` — the gateway trio and the Langy internal secret,
exactly the registry's `generate` set — and writes them into
`langwatch-<profile>` instead. A fresh checkout with a vault therefore ends with
no credential on disk at all. It never invents a provider key: a key the
registry does not mark `generate` is a miss and falls through to the refusal,
because a made-up `OPENAI_API_KEY` is worse than an absent one.

`SecretMigrationService` moves the credentials already sitting in a developer's
`.env` into the same item and rewrites those lines to `op://` references,
leaving every configuration line untouched. It takes the file's text and returns
the replacement rather than touching the disk, so the caller owns the write and
the diff stays reviewable; `rewrite: false` writes the vault and keeps the file.
A line that is already a reference is reported, not rewritten. Values never
reach stdout, a log, or the report.

**Next stage, not built here:** the invocation surface. `haven secrets push`
(or an equivalent command) is what makes the migration a thing a person runs;
today the service exists and is tested against the fake `op` port, and nothing
calls it. That is deliberate — the command is a small wiring change and belongs
with whoever decides where it lives.

### AWS Secrets Manager is shaped for, not built

An `AwsSecretsManagerSource` is one more class implementing the same `resolve`,
inserted into the chain ahead of `RefusingSecretSource`. No other seam changes.
It is not built here because nothing needs it yet, and a port with one real
implementation and one imagined one is worse than a port with two real ones.

### Guards

- `langwatch/secrets-through-source` (error): a `process.env.<SECRET_KEY>` read
  outside `packages/secrets/**`, an application config module, a process boot
  file or a test. One baselined site, the database seeder, which derives the
  API key pepper before any runtime boots.
- A test asserting `.env` has exactly three credential writers under
  `dev/scripts`, and that each writes only the keys the registry marks for it.
- `haven env` masks every classified key unless `--reveal`, pinned by a Go test
  over the registry file — including the fallback, which masks on key-name
  shape when the registry cannot be read. Masking fails closed.
- The pino node logger takes `redactPaths`; the three boot seams pass the
  secret class. That is the last line of defence, not the first.

## Alternatives considered

**Leave `.env` as it is.** Free, and the status quo: live provider keys in a
plain file on every laptop, in every worktree, rotated by nobody. It also
leaves no answer to "is this value safe to print", which is the question the
classification exists to answer — so even a team happy with `.env` wants the
registry.

**The 1Password SDK with a service-account token.** Requires storing a
long-lived secret to fetch secrets, which is circular on a laptop, and gives up
biometric unlock. Becomes the right answer only if CI ever reads from
1Password, which is a separate decision.

**A vault client inside each process.** Puts a network dependency, a session
lifetime and a new failure mode on the boot path of every process including the
production ones. The chart already solves production; the laptop is the only
problem, and a subprocess at boot is the smallest thing that solves it.

**Encrypted `.env` in git.** Moves the secret into the repository's history,
where it is permanent, and gives every contributor who can read the repository
the decryption problem instead.

## Consequences

- Boot gains one `await` and, when a vault is configured, one subprocess. In
  production the chain is one map lookup over the pod environment.
- Every process prints one boot line naming which source answered which secret
  key, so a stale shell export shadowing the vault is visible rather than
  mysterious. It carries names, never values.
- A new refusal exists (`MissingSecretsError`) but fires for nothing today:
  every registry entry is `optional` or `generate`, so an unconfigured checkout
  boots exactly as it did before. Marking a key `required` is a deliberate act
  with a named failure.
- `haven env` no longer prints secret values by default. Anyone evaluating it
  into a shell adds `--reveal`; anyone pasting it into an issue no longer has
  to remember to scrub it.
