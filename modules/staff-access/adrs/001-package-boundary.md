# ADR-001: Staff access owns operator agent access to one organization

**Status:** Accepted

**Behaviour:** [Approval](../specs/staff-access-approval.feature),
[use](../specs/staff-access-use.feature),
[pages](../specs/staff-access-pages.feature),
[CLI](../specs/staff-access-cli.feature).
Product decision: [ADR-202](../../../dev/docs/adr/202-ops-agent-access.md).

## Context

LangWatch Cloud operators sometimes need their coding agent to read or support
one customer organization. That access must be short, approved with a passkey,
limited to named scopes and visible in the customer's audit log. It cannot live
in Ops, which reads platform state, or in API keys, which serve customers.

## Decision

The `staff-access` module owns enrolled agents (requesters), access requests,
passkey challenges and the request trail. One `StaffAccessApi` token is its peer
boundary. `StaffAccessModule` privately owns the requester, request, session,
notice, availability and ops-read services and implements that interface.

## Public surfaces and transports

`transport/staff-access.rest.ts` declares the agent routes under
`/api/v1/staff-access` (request, poll, redeem, end, ops reads), authenticated by
the `staff_access` door. `transport/staff-access.trpc.ts` declares the operator
pages (enrol, approve, deny, revoke, revoke all). Every route names its
permission with `.withPermission`. The module also binds the REST gate every
staff key passes before its handler, which stamps the audit row.

## Dependencies

Peers are called only through their `*Api`: Auth (passkey assertions), ApiKey
(minting and revoking the one-hour staff key), AuditLog (customer audit rows),
Organization, Project and User (names), Ops (platform operators), FeatureFlag
(the `ops_agent_access_enabled` flag), Notification (operator notice emails),
and CodingAgent, Gateway and Trace for the ops reads. The notice email renders
through `@langwatch/mail`.

## Persistence

The module claims `StaffAccessRequester`, `StaffAccessChallenge`,
`StaffAccessRequest` and `StaffAccessEvent`. Each table has one repository with
a Prisma and a memory backend, selected at boot by
`staffAccessRepositories`. Every state change is one atomic claim on the
request row. No other module queries these tables.

## Runtime and registration

API and worker compose the same App. The worker runs the expiry pipeline, which
ends sessions past their hour and writes the expiry audit row. Nothing serves
until the feature flag is on in a cloud ops deployment.

## Environment and configuration

The only config leaf is `publicBaseUrl` (`BASE_HOST`), used to build the
approval link. Without it, requests are refused with
`staff_access_not_configured`. Module code reads no environment variables.

## Errors

Refusals are concrete handled errors in the contract
(`staff_access_already_ended`, `staff_access_rate_limited`,
`staff_access_not_configured` and others), registered in `@langwatch/handled-error`.
A failed operator notice is logged and never undoes the action.

## Contracts and validation

`@langwatch/staff-access-contract` holds the zod schemas for REST bodies and
answers, the tRPC declaration, the errors and the config. The browser imports
only the contract and its own browser package.

## Consequences

Integration tests run every scenario on both the memory and the Postgres
backend. The REST door and gate have their own integration tests in
`apps/api`, with exact refusal codes. Adding a scope or a route means updating
the specs, the contract and the gate together.
