# ADR-001: Connect is the hosted end of a connected self-hosted install

**Status:** Accepted

**Behavioural contract:** [LangWatch Connect](../specs/connect.feature)

**Related:** [ADR-156: Connected self-hosted](../../../../dev/docs/adr/156-connected-self-hosted.md)

## Context

ADR-156 lets a self-hosted install call hosted services under its licence. The
routes, their metering and the contract-budget cap need one owner on the cloud side.

## Decision

Connect owns the hosted end of LangWatch Connect as a contract and a process package.
It composes its owners and keeps no state of its own.

## Public surfaces and transports

The contract exports `ConnectApi` and the hosted answer schemas. The process package
serves `connectHostedRest` behind the gateway's internal door, and no tRPC router.

## Dependencies

Connect reaches licensing, instant-eval, the gateway and authz only through their
`*Api` tokens, and reads licensing and billing facts as a peer subscriber.

## Persistence

Connect owns no table and no repository. Budgets live in the gateway's budget table,
asked through `GatewayApi`; spend is recorded by instant-eval.

## Runtime and registration

`connect.module.ts` installs `ConnectModule`, the transport and the
`connect_contract_budget` pipeline; imports perform no registration.

## Environment and configuration

Connect declares no secrets and no config leaf; the gateway's internal secret
authenticates hosted calls.

## Errors

A payload the rules refuse throws a `ValidationError`; refusals keep the stable codes
ADR-156 names.

## Contracts and validation

A hosted payload is the install's own JSON, parsed by `rules/hosted-payload.rules.ts`
and never trusted for identity. Answers validate against the contract's Zod schemas.

## Consequences

The hosted end can change its metering or routes without touching licensing,
instant-eval or the gateway, each of which keeps its own state.
