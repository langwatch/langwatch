# ADR-001: Slack owns named connections and the claims on them

**Status:** Accepted

**Behavioural contract:** [Slack connections](../specs/slack-connections.feature)

**Related:** [Automations source merge](../../../dev/docs/adr/093-automations-source-merge.md) section 5a, and
`dev/docs/ARCHITECTURE.md` section 3.

## Context

An organization keeps any number of named Slack connections, each a bot token or an incoming
webhook, usable by the whole organization or by one project. Automations point at a connection
instead of carrying a copy of the secret, so a secret is stored once per scope and rotated there.
Slack the customer configures for delivery stays in automation's channels; this module owns the
connection records and what holds them.

## Decision

`slack` owns the connection and connection-claim tables, the checks that save a connection, and
the refusal to delete a connection while any claim exists (`slack_connection_in_use`). Other
modules call `SlackApi` (list, create, update and delete a connection; claim and release it) and
never read these tables. `SlackModule` implements `SlackApi` over `SlackConnectionService` and
`SlackConnectionClaimService`.

## Public surfaces and transports

`@langwatch/slack-contract` exports `SlackApi` and its token, the connection schemas, the
errors and the tRPC declaration. The process half serves the tRPC namespace and a REST family
from `transport/`; both stay thin over the module class.

## Dependencies

Peers: `ProjectApi` (the project and its organization), `OrganizationApi` and `AuthzApi` (who may
manage a connection). The one channel is `SlackWebApiChannel`, the save-time `auth.test` read
that tells a usable bot token from a refused one; its memory twin answers from a table it was
told about.

## Persistence

Prisma repositories hold connections and claims; each has a memory twin. A secret is never
returned to a client; a keyed fingerprint rule recognises the same secret saved twice. A foreign
key stops a connection delete that skipped the claim check.

## Runtime and registration

`slackProcessModule` installs the repositories, the module class and both transports. The
channel is chosen by tier inside `SlackModule.create` until the framework builds channel
registries (ARCHITECTURE.md section 5).

## Environment and configuration

No config slice. The fingerprint key resolves through the module's secret handles
(`credentialsSecret`, falling back to `sessionSecret`), never through `process.env`.

## Errors

Refusals are `HandledError` subclasses in the contract with stable codes. A Slack transport
failure (`request_failed`, `bad_response`) is told apart from a refused token, so a caller can
tell infrastructure from a bad secret.

## Contracts and validation

Zod validates every input at the transport; the contract schemas are the wire types. The
scenarios in `specs/slack-connections.feature` are the requirements and are bound by the unit,
repository and browser tests that name them.

## Consequences

Automation and integration reach connections only through `SlackApi`, so a secret has one
owner. The slack browser half reads the same contract. The channel's tier choice by hand is a
known gap to close when channel registries land.
