Feature: API spine hardening — licence-aware federation, provenance-checked client addresses, capped REST bodies
  As an operator running the LangWatch API process
  I want the sign-in gate, the rate-limit key and the public REST body reader
  to answer from facts the deployment controls rather than from constants or
  caller-supplied text
  So that a licensed install gets its own single sign-on, a caller cannot pick
  its own throttle bucket, and one request cannot buffer gigabytes of heap.

  From the 2026-09-04 security pass over the API spine (findings H3, H4, H5).

  Rule: federation reads the licence the deployment holds

    The API process held `federationLicensed` at false whatever licence was
    activated. A licensed self-hosted install therefore refused its own SSO
    initiation and left the email sign-up door mounted — the inversion of the
    invariant ADR-027 states.

    @unit
    Scenario: A licensed self-hosted deployment reports federation as licensed
      Given a self-hosted deployment that named a federated sign-in provider
      And its licensing service reports the platform licence valid
      When the sign-in method policy is resolved
      Then the policy reports federation as licensed

    @unit
    Scenario: A deployment with no licensing service reports unlicensed and says so at boot
      Given a self-hosted deployment composed with no licensing service
      When the Better Auth transport is composed
      Then the operator is warned that federation reports unlicensed
      And the resolved sign-in method policy reports federation as not licensed

  Rule: a forwarding header is read only from a trusted hop

    Every IP-keyed throttle in the process is keyed on the resolved client
    address. Reading a forwarding header from any peer lets a caller send a
    fresh address per attempt and never meet a limit.

    @unit
    Scenario: A forwarding header from an untrusted peer is ignored
      Given no trusted proxy addresses are configured
      When a request arrives from a socket address carrying a forwarding header
      Then the resolved client address is the socket address

    @unit
    Scenario: A trusted proxy's chain resolves to the rightmost hop it did not write
      Given the request's socket address is a configured trusted proxy
      And the forwarding chain carries a client-supplied hop, a real client and the trusted proxy
      When the client address is resolved
      Then the resolved client address is the rightmost hop no trusted proxy wrote

  Rule: one resolver answers for every per-address limit in the process

    Nothing set a client address on the tRPC context, so all eight per-IP
    limits on the signed-out procedures keyed on the literal "unknown" — one
    deployment-wide counter any unauthenticated caller could spend on
    everybody's behalf. The shared-trace limit read its own leftmost
    `x-forwarded-for` hop instead.

    @unit
    Scenario: The signed-out tRPC surface keys on the resolved address
      Given a request arriving over the API listener with a forwarding header
      And no trusted proxy addresses are configured
      When a signed-out procedure resolves its per-address key
      Then the key is the request's socket address
      And it is not the shared "unknown" key

    @unit
    Scenario: A caller whose address cannot be resolved gets its own bucket
      Given a call resolved with no transport to read an address from
      When a signed-out procedure resolves its per-address key
      Then the key names the unresolved bucket rather than a resolved caller's

    @unit
    Scenario: The shared-trace limit reads the same resolver
      Given the request's socket address is not a configured trusted proxy
      When the shared-trace read resolves the caller's address
      Then the forwarding header the caller supplied is ignored

  Rule: the public REST JSON reader refuses an oversized body while reading it

    The reader buffered the whole body before measuring it, and skipped its
    pre-check entirely on a chunked request or a non-integer Content-Length.

    @unit
    Scenario: A chunked body past the cap is refused without being buffered
      Given a public REST endpoint with a body size cap
      When a chunked request body exceeds the cap
      Then the request is refused as too large
      And the reader stops reading at the cap

    @unit
    Scenario: A body past the cap under a non-integer Content-Length is refused
      Given a public REST endpoint with a body size cap
      When a request declares a Content-Length that is not a whole number and its body exceeds the cap
      Then the request is refused as too large
