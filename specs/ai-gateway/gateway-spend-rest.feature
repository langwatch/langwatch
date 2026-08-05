Feature: Gateway spend reconciliation REST surface
  The spend table is only billing-grade if a consumer can PULL it back out
  deterministically: a cursor walk that never skips rows, org-fenced reads,
  and per-end-user rollups for the rebilling loop, all under the gateway
  path family beside budgets and virtual keys. Pull and push are two views
  of one enterprise capability and gate under the same plan flag.

  Background:
    Given an organization with an org-scoped API key and spend events in its projects

  Rule: The pull surface is a stable reconciliation read

    @integration
    Scenario: Pagination under concurrent inserts never skips a row
      Given a cursor walk is mid-flight over the spend events
      When a row folded late lands with an older occurred-at but a newer insert version
      Then a later page of the same walk serves that row
      And no row is served twice within the walk

    @integration
    Scenario: The pull is org-fenced
      Given spend events exist for a project of another organization
      When the caller lists spend events
      Then only rows from the caller's own organization appear

    @integration
    Scenario: A garbled cursor is refused, not silently reset
      When the caller passes a cursor that does not decode
      Then the request fails with a bad-request error
      And the walk is not restarted from the beginning

    @unit
    Scenario: Cursor encoding round-trips every version and id pair
      When a cursor is encoded from an insert version and a request id
      Then decoding it returns exactly the same pair
      And garbage input decodes to nothing

    @unit
    Scenario: The response documents the retention window and dedup guidance
      Then the pull route's contract states the fixed thirteen month window
      And it warns about downstream biller dedup windows

  Rule: Rollups serve the rebilling loop

    @integration
    Scenario: The end-user rollup sums exactly that user's requests in the window
      Given spend events for two different end users
      When the caller reads one end user's windowed spend
      Then the rollup covers only that user's requests
      And it carries the token classes and request count

    @integration
    Scenario: A virtual key filter narrows the rollup
      Given one end user's spend spread across two virtual keys
      When the caller reads the rollup filtered to one key
      Then only that key's spend is summed

  Rule: The surface is org-authenticated and enterprise-gated

    @integration
    Scenario: Requests without an org API key are unauthorized
      When a request arrives with no credentials
      Then it is rejected as unauthorized

    @integration
    Scenario: Without the plan flag the surface refuses politely
      Given the organization's plan lacks the webhook endpoints flag
      When the caller lists spend events
      Then the request fails with a forbidden error naming the enterprise feature
