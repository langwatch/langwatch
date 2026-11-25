# ADR-001: Enterprise gateway package boundary

**Status:** proposed

**Behavioural contract:** [Enterprise gateway routing policies and personal virtual keys](../specs/enterprise-gateway.feature)

## Context

Routing policies and personal virtual keys are Enterprise-licensed subjects of
the AI Gateway, so they belong neither to core `gateway` nor to `governance`.

## Decision

`enterprise-gateway` owns routing policies and personal virtual keys.
`EnterpriseGatewayApi` lists, reads, counts, creates, updates, sets the
default for and deletes policies, suggests tier targets, finds the default
policies binding a personal workspace, and lists, issues, revokes and ensures a
default personal key. The keys themselves stay the core gateway's,
reached through `GatewayApi`.

## Public surfaces and transports

Two tRPC namespaces at main's wire names. `routingPolicy.*`: reads need
`routingPolicies:view`, writes `routingPolicies:manage`.
`personalVirtualKeys.*`: `list` answers the caller's own keys, or anyone's
under `virtualKeys:viewOtherPersonal`, and refuses non-members; `issuePersonal`
needs `organization:view` and is refused, as `virtualKeys:create`, while an
operator impersonates a member; `revokePersonal` needs `organization:view`.
The CLI operations on the Api do no admission of their own; the governance CLI
door admits the caller before calling them.

## Dependencies

`GatewayApi`, `ProjectApi`, `OrganizationApi`, `AuthzApi` and
`ModelProviderApi`. `isSaas` is the member read.

## Persistence

The routing-policy and policy-scope tables in Postgres, a Prisma repository
with a memory twin.

## Runtime and registration

`enterpriseGatewayProcessModule` registers the repositories, the Api and the
two tRPC transports. No pipeline, job or subscriber.

## Environment and configuration

`enterpriseGatewayConfig` reads the gateway public and legacy URLs; with
`isSaas` they decide the address an issued personal key sends traffic to.

## Errors

Handled errors from the contract: `personal_virtual_key_label_taken`,
`no_eligible_model_providers`, `routing_policy_has_no_providers`,
`virtual_key_not_found`, and the routing-policy guards (provider, scope,
concrete model) mapped to handled errors. Refusals are `permission_denied`.

## Contracts and validation

Zod schemas in the contract; the tRPC declarations carry main's caps on names,
labels and scopes.

## Consequences

One owner for Enterprise routing; core gateway and governance declare neither
namespace, and governance counts policies through `EnterpriseGatewayApi`.
