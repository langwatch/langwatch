# ADR-001: Sample Agents package boundary

**Status:** proposed

**Behavioural contract:** [Demo hotel bot](../specs/hotel-bot.feature)

## Context

The sample project is filled by demo agents whose runs land as traces in the
caller's project.

## Decision

`sample-agents` owns the demo agents. It exposes `SampleAgentsApi`
(`runHotelBot`). The contract holds the Api token, the hotel-bot input and
reply, and the module's handled errors.

## Public surfaces and transports

One REST transport, `hotel-bot.rest.ts`.

## Dependencies

No module dependencies. The logger and `publicBaseUrl` are the members read.

## Persistence

None. A run's output is traces sent to the collector.

## Runtime and registration

`sampleAgentsProcessModule` registers the Api; the REST transport is kept but
unmounted, refused to every caller until the platform-operator door lands
(`.claude/coordinator/rulings-2026-10-05.md`, hotel_bot; E4 in
`dev/docs/plans/api-framework-bypass-2026-10-05.md`). The
OpenAI chat and trace collector are channels with HTTP and memory twins.

## Environment and configuration

The platform's OpenAI key enters as a declared secret handle; module code
reads no environment.

## Errors

Failures surface as the module's handled errors.

## Contracts and validation

The run input and reply are contract schemas, parsed at the REST door.

## Consequences

Demo traffic has one owner and never needs a caller's own provider key.
