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

  Rule: A window that cannot hold anything is refused, not answered

    @integration
    Scenario: An inverted window is refused on both reads
      When the caller asks for spend from a later instant to an earlier one
      Then the request is refused on the rollups as it already was on the events
      # An inverted window is an empty window, so answering it hands back a
      # confident zero. A reconciliation that checksums against that zero
      # decides the books agree.

  Rule: Both spend reads narrow on the same filters

    # A reconciliation that can only be sliced one way on the rollups and
    # another on the events cannot check its own arithmetic: the caller
    # cannot ask the two surfaces the same question.

    @unit
    Scenario: A filter offered on one read is offered on the other
      Then every filter the events read accepts is accepted by the rollups
      And every filter the rollups accept is accepted by the events read

    @integration
    Scenario: A filter repeated in the query matches any of the values it names
      Given spend across three models
      When the caller names two of them
      Then the read covers those two models and no others

    @integration
    Scenario: A team filter narrows to the projects that team owns
      Given two teams in the organization, each owning its own projects
      When the caller filters to one team
      Then only spend from that team's projects is summed

    @integration
    Scenario: A filter that matches nothing answers empty rather than everything
      When the caller filters to a virtual key belonging to another organization
      Then the read is empty
      # A filter list that resolves to no ids must not collapse into an
      # absent predicate. Reading as unfiltered here would hand a caller
      # the whole organization's spend under a narrowing they asked for.

    @unit
    Scenario: One filter may not name unbounded values
      When the caller repeats a filter more times than the surface allows
      Then the read is refused, naming that filter
      # Every value becomes an element of a bound array and every metadata
      # pair a predicate of its own, so an unbounded repeat is an unbounded
      # query on a billing read.

    @unit
    Scenario: Every status the surface publishes can be narrowed on
      Then each status in the published vocabulary resolves to a lifecycle status
      # The boundary validates against the published list and the query
      # builder resolves against its own. If the two are written out
      # separately, a status added to one is accepted at the door and then
      # fails inside, turning a valid request into an unknown error.

    @unit @integration
    Scenario: The rollups refuse a status they can only answer with zero
      Given requests still in flight alongside completed ones
      When the caller asks the events read for the in-flight status
      Then those envelopes are served
      But the same narrowing on the rollups is refused, naming the status field
      And a completed status is still accepted by the rollups
      # A rollup sums the cost of requests past admission, so an in-flight
      # request contributes nothing to one. Accepting the narrowing and
      # answering zero would tell a reconciliation the books agree; the
      # refusal says where the answer lives instead.

  Rule: The caller's own metadata is filterable

    @integration
    Scenario: Filtering on a metadata pair narrows to the requests carrying it
      Given spend recorded with a customer tier on each request
      When the caller filters to one tier
      Then only requests carrying that tier are summed

    @integration
    Scenario: Metadata recorded before the filter shipped is still matched
      Given spend recorded before the metadata filter existed
      When the caller filters on a pair carried by those older requests
      Then they are matched
      # The filter reads metadata through a derived column. If the store
      # served a default for records written before that column was
      # declared, every historical request would silently drop out of a
      # filtered reconciliation and the books would agree on a subset.

    @unit
    Scenario: A metadata pair with no colon is refused, not re-cut
      When a pair arrives without the separator the surface splits on
      Then it is refused rather than cut at some other point
      # Cutting an absent separator is silently wrong rather than empty:
      # the last character becomes the boundary, so the caller reads spend
      # for a key nobody wrote.

  Rule: A grouping whose key can move is refused while the window can still change

    # Where a request lands is fixed for its key, its end user and its
    # project, but the model and the provider it names on admission are
    # replaced by the ones that actually served it. A walk grouped on
    # those can serve a request twice, or skip it, when a late outcome
    # moves it between groups mid-walk. A checksum that silently drops
    # rows is worse than one that refuses.

    @integration
    Scenario: Grouping on a movable key is refused while the window is still settling
      When the caller groups by model over a window reaching the present
      Then the request is refused as an unstable grouping
      And the refusal says which grouping moved and how to ask anyway

    @integration
    Scenario: The same grouping is served once the window has settled
      When the caller groups by model over a window old enough to have settled
      Then the rollup is served

    @integration
    Scenario: A caller who accepts the risk can ask for it anyway
      When the caller groups by model over a live window and accepts an unstable read
      Then the rollup is served

    @integration
    Scenario: Grouping on a key that cannot move is never refused
      When the caller groups by end user over a window reaching the present
      Then the rollup is served

    # The opt-out arrives as a query string, so how it is read is part of the
    # guard rather than a detail beneath it. Read as JavaScript truthiness,
    # every non-empty value means yes and the clearest way to say no turns the
    # guard off.
    @integration @regression
    Scenario: Declining an unstable read is not the same as accepting one
      When the caller groups by model over a live window and explicitly declines an unstable read
      Then the request is refused as an unstable grouping

    @integration
    Scenario: The opt-out is read however the caller's HTTP library spells a boolean
      When the caller groups by model over a live window and accepts an unstable read in any casing
      Then the rollup is served

    @integration
    Scenario: A spelling the surface does not know is refused by name
      When the caller groups by model over a live window and spells the opt-out in a way the surface does not know
      Then the request is refused and the refusal names the parameter

    @integration
    Scenario: A cursor from another grouping is refused, not silently restarted
      Given a rollup walk paged under one grouping
      When the caller sends that cursor back under a different grouping
      Then the request is refused and says to start a new walk
      # Carrying on without the cursor would serve the first page again
      # under a fresh cursor, with nothing in the response to say the walk
      # had reset, and the checksum would count those groups twice.

    @unit @integration
    Scenario: A time zone the store cannot load is refused at the door
      When the caller names a fixed offset rather than a zone
      Then the request is refused, naming the timezone parameter
      # The runtime accepts an offset and the store does not, so passing it
      # through turns a value the caller chose into an unknown error from
      # somewhere they cannot see.

  Rule: An organization running a project per customer still reads its spend

    @integration
    Scenario: The rollup covers every project without the caller naming them
      Given an organization with many projects
      When the caller reads spend without naming a project
      Then spend from every project is covered

    @integration
    Scenario: Naming projects narrows the read to them
      Given an organization with many projects
      When the caller names two of them
      Then only those two projects are covered

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
