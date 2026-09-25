Feature: SSO connection history - the raw events, read and live
  As an organization administrator and a LangWatch operator
  I need to see the chain of things that happened to a single sign-on
  connection, as they happen
  So that I can tell what actually occurred - registered, domain claimed,
  proof recorded, domain verified or attested, connection activated,
  suspended, resumed, teardown requested, migration route decided, arrival
  policy set - without asking support to read the event log for me

  # ADR-117 SS5 (D04) already event-sources every fact about a connection;
  # this is the first surface that reads the log itself rather than only the
  # folded projection. Unlike the SCIM request log (ADR-126,
  # specs/identity/scim-request-log.feature), which is deliberately a TABLE
  # because a request authors nothing, a connection's history is the log
  # itself: every entry is a fact the aggregate already states, so there is
  # no separate store, no retention sweep and no "we cannot attribute this"
  # case - only a read.
  #
  # READ ONLY, structurally. Nothing here writes a new fact, adds a table or
  # instruments a new domain event; the history panel is a projection of
  # `SsoConnectionEvent`s already appended by `SsoConnectionLedgerWriter`.
  # The one addition that is not a pure read is the live-update signal below,
  # which carries no payload beyond "something changed here" - the client
  # re-reads the same guarded queries, so the signal authors no fact either.
  #
  # Tenancy is structural, the way the identity log's and the SCIM sync log's
  # both are: the connection pipeline's aggregate id is the connection and its
  # tenant is the organization (ADR-117 SS5), so a read is a single-tenant scan
  # by construction - naming another organization's connection finds nothing,
  # which reads exactly like a connection that does not exist.
  #
  # LIVE UPDATES ARE SCOPED TO THE SSO SETTINGS SURFACE, NOT GLOBAL. The
  # subscription is one more procedure on `ssoSetupRouter` - the same router
  # `getSetup` and `getHistory` already live on - and the browser only opens
  # it from inside `HistorySection`, the one component that already reads
  # `getHistory`. It is never registered in a root layout, an app shell or
  # any provider that mounts outside the identity provider page, so leaving
  # the page tears the connection down the ordinary way a component-scoped
  # tRPC subscription always does - there is no second, wider channel
  # anywhere in the product to find this one growing into.
  #
  # NO NEW WRITE PATH AND NO NEW DOMAIN EVENT. The subscription is a bounded
  # poll loop inside the request handler: on an interval, it re-reads the
  # SAME guarded service this feature already exposes
  # (`SsoConnectionHistoryService.getHistory`), compares the newest event id
  # it saw last tick, and yields a bare "something changed" signal when that
  # id differs. Nothing is appended to any pipeline, no broadcaster is
  # touched, and `pipelineRegistry.ts` and the sso-connections pipeline are
  # untouched - the poll is exactly as much instrumentation as the read
  # endpoint it calls, because it IS that endpoint, called on a timer
  # instead of on a page load.
  #
  # THE GUARD IS THE SAME GUARD AS THE READ IT REFRESHES, not a second one to
  # get right. In this pass the subscription exists to refresh exactly one
  # query - `getHistory` - so it takes the identical `organizationId` /
  # `connectionId` input and the identical `sso:manage` permission. A
  # broader "something changed anywhere on this page" signal that also woke
  # `getSetup` (`sso:view`) would need its own scenario and its own review
  # before it existed; this feature does not add one.
  #
  # THE HISTORY READ ITSELF IS `sso:manage`, NOT `sso:view`. Every other read
  # on this router - the overview, the setup journey, the migration progress
  # - is `sso:view`, because they answer "where does the connection stand"
  # and a security reviewer with read-only access is exactly who should see
  # that. The history is a different disclosure: it is close to an audit
  # trail of every actor who has touched the connection, including a
  # claim's rejection note and an attestation's, and that is deliberately
  # held to `sso:manage` - whoever could act on the connection, not everyone
  # who may merely see it.

  Background:
    Given an organization "acme" with a single sign-on connection "acme-okta"
    And a second organization "globex" with its own connection

  @unit
  Scenario: What happened is listed newest first
    Given "acme-okta" was registered, had "acme.com" claimed, approved and verified, and was activated
    When "acme"'s administrator reads the connection's history
    Then the five facts are listed newest first
    And each one carries when it happened

  @unit
  Scenario: The words never leak an internal event name or a raw code
    Given "acme-okta"'s history carries a domain claim that was declined with a note
    When the history is read
    Then each entry reads as a sentence a customer can act on
    And no entry names the event's own type string

  @unit
  Scenario: An attested domain is never described as one the customer proved
    Given "acme.com" was verified on "acme-okta" by a platform operator's attestation rather than a published record
    When the history is read
    Then the entry says a LangWatch operator verified it
    And nothing about it reads as the customer's own proof

  @unit
  Scenario: A connection carried over from an earlier configuration says so
    Given "acme-okta" was created by the grandfather migration rather than by "acme" itself
    When the history is read
    Then every entry the migration produced is marked as carried over
    And an entry "acme" produced itself is not

  @unit
  Scenario: Another organization's connection history is not there to read
    Given "globex" has its own connection with its own history
    When "acme-okta"'s history is read against the event log directly
    Then only events appended under "acme"'s own tenant come back
    And naming "globex"'s connection under "acme"'s tenant finds nothing

  @integration
  Scenario: An administrator reads their own connection's history on the identity provider page
    Given "acme-okta" has a history of what happened to it
    When "acme"'s administrator opens the identity provider page
    Then the history panel lists what happened, newest first
    And no control on the panel changes anything

  @unit
  Scenario: Seeing the history takes managing single sign-on, not only seeing it
    Given an administrator who may see single sign-on but may not manage it
    When they ask for the connection's history
    Then the request is refused
    And the same administrator reading the overview or the setup journey is not

  @unit
  Scenario: An operator reads a connection's history from the back office, gated like the rest of that surface
    Given "acme-okta" has a history of what happened to it
    When an operator asks the back-office router for its history
    Then a LangWatch operator on the staff list is answered the history
    And anybody outside the staff list is answered the same not-found the rest of that surface gives

  # ── Live updates (SSO settings pages only, not global) ─────────────────

  @unit
  Scenario: A poll that finds nothing new says nothing
    Given "acme-okta"'s history has not changed since the last check
    When the live-update poll runs again
    Then no signal is sent
    And the page's own queries are left exactly as they were

  @unit
  Scenario: A new fact wakes the signal, and only for its own organization
    Given "acme-okta" gains a new fact while "globex"'s own connection also changes
    When the poll for "acme"'s subscription runs
    Then it sees only "acme-okta"'s new fact and signals once
    And nothing about "globex"'s change reaches it, because the poll never reads "globex"'s tenant

  @unit
  Scenario: The live subscription is gated exactly like the read it refreshes
    Given an administrator who may see single sign-on but may not manage it
    When they open a subscription for "acme-okta"'s history activity
    Then it is refused with the same permission "getHistory" itself requires

  @integration
  Scenario: The identity provider page refreshes its history when something changes
    Given "acme"'s administrator has the identity provider page open with the history panel visible
    When the activity subscription yields a signal
    Then the page re-reads the history it already had permission to see
    And nothing about the signal itself is rendered anywhere
