# ADR-001: Onboarding package boundary

**Status:** proposed

**Behavioural contract:** [Guided onboarding](../specs/guided-onboarding.feature),
[Setup checklist](../specs/integrations-checks.feature),
[Product analytics](../specs/onboarding-product-analytics.feature),
[Project create](../specs/onboarding-project-create.feature)

## Context

Sign-up, guided onboarding and the setup checklist need one owner across the
browser and the server.

## Decision

`onboarding` owns guided onboarding state, the setup checklist and the
onboarding screens. It exposes `OnboardingApi` and the integrations-checks
Api. The contract holds the Api token, the tRPC declarations, the REST
schemas, the guided-onboarding events and the handled errors.

## Public surfaces and transports

Two tRPC transports (onboarding, integrations checks) and one REST transport.
The browser package mounts the onboarding screens.

## Dependencies

`OrganizationApi`, `AuthzApi`, `OpsApi` and `GatewayApi`, among others
declared on `OnboardingModule`.

## Persistence

Guided onboarding state is the guided-onboarding lifecycle pipeline's.

## Runtime and registration

`onboardingProcessModule` registers the Api, the three transports, the
lifecycle eventing and the REST credential binding. Product analytics leave
through the PostHog channel, with HTTP and memory twins.

## Environment and configuration

None read directly; the browser reads deployment state from injected config.

## Errors

Refusals are the contract's handled errors.

## Contracts and validation

Transports parse the contract schemas; events parse at the pipeline.

## Consequences

One owner for onboarding, front to back.
