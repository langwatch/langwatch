# Overengineering, and how we catch it

Abstraction is a purchase. It buys the freedom to change one thing without
touching another, and it costs every reader a file they have to open, a name
they have to learn and an indirection they have to follow. Most of the
abstraction in this repo is worth it. This document is about the part that is
not, and about the rules that now find it without anyone having to notice.

## The reference: what "simple enough" looks like

The Go services configure themselves like this
(`services/nlpgo/config.go`, `pkg/config/config.go`):

```go
type Config struct {
    Environment string        `env:"ENVIRONMENT"`
    Server      config.Server `env:"SERVER"`
    Engine      EngineConfig  `env:"NLPGO_ENGINE"`
}

func defaultConfig() Config {
    return Config{Environment: "local", Server: config.Server{Addr: ":5562"}}
}

func LoadConfig(ctx context.Context) (Config, error) {
    cfg := defaultConfig()
    if err := config.Hydrate(&cfg); err != nil { return Config{}, err }
    return cfg, config.Validate(ctx, cfg)
}
```

The shape **is** the type. The default **is** a value of that type. The
environment binding is a tag beside the field it binds. Nesting is a nested
struct, and `Hydrate` chains the prefix. One 104-line reflective hydrator
serves every Go service in the repo, and a reader who has never seen it can
still tell what `NLPGO_ENGINE_STREAM_HEARTBEAT_SECONDS` sets.

It even declines to be clever where cleverness would cost: it *refuses* a
`time.Duration` field outright, because one config surface with two notations
for a time span is worse than one notation everybody has to spell out.

## The counter-example: `packages/config`

`@langwatch/config` does the same job. It reaches for:

- `ConfigLeaf<T>`, a marker interface branded with `_configLeaf: true`
- `RuntimeConfigDefinition`, a recursive index signature
- `ConfigDefinitionNode`, a five-way union
- `ConfigValue<Definition>`, **six nested conditional types**, to re-derive a
  shape a plain interface already states
- `RuntimeConfig.create` with **three overloads**
- `RuntimeConfig.define` → `defineRuntimeConfig` → `return definition` — an
  **identity function reached through a wrapper**
- `configUrl`, `configSecret`, each with **two overloads that differ only by
  `optional: true` versus `optional: false`**
- a `Config` namespace object bundling five one-line factories
- and **five** exported "read a boolean from the environment" schemas —
  `environmentBooleanSchema`, `environmentPresenceSchema`,
  `environmentExactOneSchema`, `environmentNotExactOneSchema`,
  `environmentLegacyTruthySchema` — plus a sixth defined privately

Go has one boolean reader: `strconv.ParseBool`.

Every one of those five schemas exists to preserve a different legacy spelling
of "on". That is a real constraint and the comments explaining it are honest.
But preserving five conventions *forever*, in a shared package, is a decision
nobody made — it is what happens when the migration path becomes the design.

## The signals, and what finds them

| Signal | Found by | Where |
| --- | --- | --- |
| A named function that returns its own argument | `no-identity-function-ts` | `dev/lint/ast-grep/rules/` |
| A method forwarding to the same name on a collaborator | `no-same-name-delegation-ts` | `dev/lint/ast-grep/rules/` |
| A class that forwards most of its methods to **one** collaborator | `layer-class` | `packages/architecture-lint/src/overengineering.ts` |
| A type alias nesting conditional types past 3 | `conditional-type-depth` | same |
| Overloads differing only by a boolean literal | `overload-by-literal` | same |
| A comment block over 60 lines | `comment-block-size` | `src/comment-blocks.ts` |
| A service module over its size ceiling | `service-quality` | `src/service-quality.ts` |

The ast-grep rules run from `make lint-rules` and are proved against fixtures
by `make lint-rules-test`. The architecture-lint policies run from
`pnpm --filter @langwatch/architecture-lint lint`.

None of them is a verdict. `layer-class` exempts `app/<feature>.app.ts` and
routed repositories because both are supposed to delegate; the others fire on a
handful of places repo-wide, which is the point — a rule that fires everywhere
teaches nobody anything.

**A service publishing its own repository's verbs is not a layer either.**
CLAUDE.md forbids a transport from touching a repository, so the service has to
expose them; `QueueService` looks like 21 pass-throughs precisely because the
repository beneath it is private and nothing else may reach it. The policy skips
a class whose forwards all land on a field typed `*Repository`. (That the two
share a method name is a separate, real problem — repositories are meant to be
`findAll`/`findById` and services `getAll`/`getById`, so a same-name pair means
the repository is named like a service.)

**Composition is not a layer.** `layer-class` counts the DISTINCT collaborators
a mostly-forwarding class delegates to, and only reports it when they are all
the same one. `ApiKeyService` forwards 30 of its 32 methods, but to seven
different fields, each the specialist for that verb — deleting it would hand
every consumer seven objects instead of one published interface, which is worse
on every axis. `QueueService` forwards 21 of 34 to `this.repository`, renaming
each call on the way; that one is a layer. The report names the receiver so you
can tell which you are looking at without opening the file.

## The questions to ask instead

Before adding an abstraction, and when reviewing one:

1. **Does it have a second implementation, or an open set?** A port with one
   implementation in the same package is a seam to nowhere. Three storage
   backends behind one interface, or one canonicaliser per vendor, are not.
2. **Does the type derive what a value could just state?** A conditional type
   that reconstructs a shape is usually re-deriving something an interface,
   a discriminated union or `satisfies` already says once.
3. **Is the wrapper adding a decision?** `define(x) { return x }` adds none.
   Neither does a method whose body is one call with the same name.
4. **Is the flexibility used?** An optional dependency the composition root
   always supplies is not optional — it has traded a compile error for a
   runtime throw. Check the composition root before you believe the type.
5. **Would a new joiner guess right?** The Go config passes this: field, tag,
   default, done. Six conditional types do not.

## What this is not

It is not an argument for fewer files, or for putting everything in one class.
`services/canonicalisation/` is sixteen files, one per vendor, and that is
correct: the set is open and its members vary independently. `DatasetStorage`
has three implementations and earns its interface. The trace `ports/` directory
is 26 one-method files because `strict-port-module` requires it.

The target is code that does what it does well and does not try to do more —
not code with the fewest lines.
