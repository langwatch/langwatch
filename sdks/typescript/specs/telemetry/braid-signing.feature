# Decisions: dev/docs/adr/183-braids-show-matching-spans-in-another-projects-traces.md
# (ADR-183) section 4, wire format version 1. The platform side: modules/trace/specs/signed-calls.feature.
# The same pinned vector is asserted in the Python and Go SDKs.

@telemetry @braids
Feature: The SDK signs braid entries on the calling side and copies them on the called side
  As a developer whose service calls a service in another project
  I want my named baggage entries signed over the trace, and copied onto the called side's spans
  So that a braid can require that my project really made the call

  Rule: The signature is wire format version 1, identical in every SDK

    @unit
    Scenario: The pinned vector produces the shared signature
      Given the signing key "lwsk_testkid_testsecret" and the trace id "0af7651916cd43dd8448eb211c80319c"
      When the entries orchestrator "web" and team "a" are signed
      Then the signature is the string every SDK's test pins

    @unit
    Scenario: Signing puts each entry and the signature in baggage
      Given a context holding a span
      When the entries orchestrator "web" and team "a" are signed into it
      Then its baggage holds orchestrator, team and langwatch.signature

  Rule: Signing refuses what it cannot sign

    @unit
    Scenario: A signing key not of the form lwsk_<publicId>_<secret> is refused
      When an entry is signed with a key with no prefix, an empty publicId, a publicId outside [A-Za-z0-9] or an empty secret
      Then a braid signing error with code malformed_signing_key is thrown

    @unit
    Scenario: An entry value holding a line break is refused
      When the entry orchestrator is signed with a value holding "\n" or "\r"
      Then a braid signing error with code invalid_entry_value is thrown

    @unit
    Scenario: An entry key outside the allowed pattern is refused
      When the entry "bad key" is signed
      Then a braid signing error with code invalid_entry_key is thrown

    @unit
    Scenario: An empty set of entries is refused
      When no entries are signed
      Then a braid signing error with code empty_entries is thrown

    @unit
    Scenario: Signing outside a trace is refused
      Given a context holding no span
      When an entry is signed into it
      Then a braid signing error with code no_active_trace is thrown

  Rule: Browser bundles can import the copy side

    @unit
    Scenario: The general observability entry's braid exports reach no Node built-in
      Given the braid exports of the general observability entry
      When every module they import is followed
      Then none imports node:crypto or any other Node built-in
      And signing is exported from the Node entry instead

  Rule: The called side copies the named entries and the signature onto every span

    @unit
    Scenario: A span started under signed baggage carries the entries and the signature
      Given a tracer provider with the braid copy processor for orchestrator and team
      When a span starts under baggage signed with orchestrator "web" and team "a"
      Then the span's attributes hold orchestrator, team and langwatch.signature with the baggage values

    @unit
    Scenario: Entries the processor was not told to copy stay off the span
      Given a tracer provider with the braid copy processor for orchestrator
      When a span starts under baggage holding orchestrator and an unnamed entry
      Then the span carries orchestrator and not the unnamed entry
