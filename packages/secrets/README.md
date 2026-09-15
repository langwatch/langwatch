# @langwatch/secrets

Server-only. Never imported by a web package, and never by
`@langwatch/config`'s browser projection: this package owns a subprocess.

## What it is

`keys.json` classifies every environment variable name that carries a
credential. It is the **one source of truth**: this package parses it with Zod,
and haven reads the same file in Go, so a key added once is masked everywhere.

| Class | Meaning | In a log line |
| --- | --- | --- |
| `secret` | A rotating credential, 29 keys | `[redacted]` |
| `composite` | Shape and credential in one string, 10 keys | scheme, host, port and path kept; userinfo and query stripped |
| `pointer` | Names a credential on disk (`GOOGLE_APPLICATION_CREDENTIALS`) | verbatim |
| `config` | Everything else, ~90 keys | verbatim |

## The port

`SecretSource` has one method, `resolve({ keys })`, batched so a source backed
by a subprocess pays once per boot. Adapters: `EnvSecretSource` (the shell
environment plus the `.env` the application already loads),
`OnePasswordSecretSource` (`op://` references, and a
`op://<vault>/langwatch-<profile>/<KEY>` lookup when `LANGWATCH_SECRETS_VAULT`
is set), `ChainedSecretSource` (ordered, first answer wins, records which
source answered each key by name), `RefusingSecretSource` (the tail, names what
is missing).

An `AwsSecretsManagerSource` drops in as one more class implementing the same
`resolve` — no other seam changes.

## The chain

Development: shell environment and `.env`, then 1Password when a vault is named
or an `op://` reference is present, then refuse. Production: environment, then
refuse — `OnePasswordSecretSource` is not constructed when
`NODE_ENV=production`, so a pod never shells out and holds no vault session.

Resolution happens **before** the runtime's Zod parse, so every feature
downstream still receives plain values, and it returns a new frozen record
rather than mutating `process.env`.

## Writing into the vault

Both writes are gated on `LANGWATCH_SECRETS_GENERATE`, because writing to
someone's vault as a side effect of starting a stack would be a surprise.

`DevGeneratedSecretSource` mints the four values the two `ensure-*.sh` scripts
would have written into `.env` and puts them in `langwatch-<profile>` instead.
It never invents a provider key.

`SecretMigrationService` moves the credentials already in a `.env` into the same
item and rewrites those lines to `op://` references, leaving configuration
alone. It takes the file's text and returns the replacement — the caller owns
the write, so the diff stays reviewable. The command that invokes it
(`haven secrets push` or equivalent) is the next stage and does not exist yet.
