# ADR-001: One Prompt service boundary

**Status:** Accepted
**Behavioural contract:** [Prompt service](../specs/prompt.feature)

## Context

Prompt configurations, immutable versions, tags, copies, sync behaviour, and
SDK Prompt metadata had accumulated in application transports and trace code.
That exposed persistence and Prompt interpretation to callers that should only
adapt transport or trace data.

## Decision

`prompt` is one singular feature: versions and tags are subordinate Prompt
behaviour, not independent features.

- `@langwatch/prompt-contract` owns portable Zod 4 schemas, values, errors,
  shorthand parsing, trace-attribute parsing, and the abstract Prompt service
  capability. It has no app, Prisma, tRPC, Hono, React, or environment imports.
- `@langwatch/prompt-server` owns the implementation, private repository port,
  and persistence adapters. Generated Prisma records remain inside those
  adapters.
- `@langwatch/prompt-web` owns browser-safe Prompt presentation helpers and
  components. It receives data and callbacks from app composition.

The app constructs one Prompt service. Existing tRPC procedures and
`/api/prompts` remain compatibility transports: they keep their authentication,
permission checks, routes, envelopes, and error mapping, and call that service
without constructing repositories or services per request. Trace continues to
own trace traversal; it consumes the Prompt contract to interpret Prompt SDK
attributes.

Prompt may consume Model Provider only through its contract. Runtime
configuration is passed at composition, never read at import time.

## Public surfaces and transports

The contract publishes the Prompt values, errors, shorthand and trace-attribute
parsing, and the abstract Prompt service. The server package publishes only its
composition adapter and the service type. The web package publishes browser-safe
presentation helpers and components. Prompt mounts no route of its own: the
`prompts` and `promptTags` tRPC routers and the `/api/prompts` REST application
are compatibility transports that call the composed service and keep their own
authentication, permission checks, envelopes and error mapping.

## Dependencies

The contract depends on the shared handled-error package and Zod. The server
depends on that contract, on the Model Provider contract for the default model
configuration a prompt version needs, on the shared observability logger, on a
small identifier generator, and on the generated Prisma client. The web package
depends on Chakra UI, React and icon libraries only; it holds no dependency on
the server package.

## Persistence

Private Prisma repositories own the prompt configuration, its immutable
versions, tags and tag assignments. Version history is append-only, so an
existing version is never rewritten. The prompt repository also reads a
project's owning organization, which is the one foreign lookup left inside this
boundary and belongs with Project once that read has a canonical service call.

## Runtime and registration

Process composition builds one Prompt adapter from the Prisma client and the
Model Provider service, then exposes it on the application context. Importing
the feature registers nothing: Prompt owns no worker job, subscriber or event
pipeline, so one instance serves the web and worker roles, and Trace reads
Prompt metadata through the same contract rather than through a second
instance.

## Environment and configuration

Prompt packages read no environment value at import time or afterwards. The
database client and the Model Provider service are the composition adapter's
only arguments, and both are supplied by the process that builds it.

## Errors

A missing prompt, a system-prompt conflict and a missing required system prompt
throw handled errors carrying the codes `prompt_not_found`,
`prompt_system_prompt_conflict` and `prompt_system_prompt_required`. Tag
failures and handle generation failures carry their own stable codes on concrete
errors that the transports map to the responses their callers already receive.

## Contracts and validation

Zod 4 schemas define prompt configurations, versions, tags and the Prompt
metadata carried on trace spans. The same schemas parse shorthand and trace
attributes, so a trace projection and a trace view read identical shorthand,
version, tag and variable semantics from one parser. Generated Prisma records
stay inside the persistence adapters.

## Consequences

Prompt behaviour and its portable vocabulary can evolve independently of the
app shell. Transports stay stable while persistence and UI implementation move
behind the Prompt surfaces. Consumers of Prompt SDK metadata share one parser,
so trace projections and trace views retain identical shorthand, version, tag,
and variable semantics.
