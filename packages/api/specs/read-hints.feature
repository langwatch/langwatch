# Record: dev/docs/ARCHITECTURE.md §10, "Server events say when a read is stale".
Feature: A browser read is refetched when an event its contract names is committed
  A read's contract names the committed events that make it stale, each hinted under the event's
  own tenant or under a field of its data. One framework subscriber, registered after the modules
  install, turns each such event into `{ path }` on the framework's own channel
  `eventing:read_invalidated`, coalesced per event and tenant; presence subscribes to it and is the
  only writer of the browser-facing `broadcast:*` wire. `presence.onOrganizationReadHints`
  (`organization:view`) and `presence.onProjectReadHints` (`project:view`) relay the hints of the
  caller's user, organization and, for the project stream, project to each visible tab, which refetches the
  reads mounted under that path and marks them stale in the other tabs. A read is otherwise trusted
  for 5 minutes, and nothing in the framework polls. Hints carry no data: the refetch enforces the
  read's own permission.

  # Contract

  @unit
  Scenario: A read names the committed events that make it stale
    Given a contract read declared with "lw.project.created" in its invalidating events
    When the contract is built
    Then the read carries the events it named
    And a read that names none carries no invalidating events

  @unit
  Scenario: A read names the event field its hint is scoped by
    Given a read invalidated by "lw.project.created" scoped by "organizationId"
    When the contract is built
    Then the read carries the event and the field

  @unit
  Scenario: Every scope a read names is a field of its event's data
    Given "organization.getScopeGraph" and the events it names
    Then every scope field it names exists in that event's data schema

  @unit
  Scenario: Every read naming an event is found from that event
    Given two installed contracts whose reads both name "lw.project.created"
    When the framework collects the hinted reads
    Then "lw.project.created" maps to both procedure paths with their scopes
    And an event no read names maps to nothing

  @unit
  Scenario: A read naming an event no installed pipeline declares is refused at boot
    Given a read naming an event type that no installed pipeline declares
    When the hint subscriber is built
    Then it refuses, naming the event type and the read

  # Worker

  @unit
  Scenario: A committed event a read names publishes one hint per read and tenant
    Given "organization.getScopeGraph" names "lw.project.created" scoped by "organizationId"
    When a project is created in organization "acme"
    Then "{ path: organization.getScopeGraph }" is published on "eventing:read_invalidated" for tenant "acme"

  @unit
  Scenario: An unscoped read is hinted under the event's own tenant
    Given a read naming "lw.authz.grant.revoked" with no scope
    When a grant is revoked under tenant "acme"
    Then its hint is published for tenant "acme"

  @unit
  Scenario: A scoped event without that field publishes nothing for that read
    Given a read scoped by "organizationId"
    When its event arrives with no organization id
    Then no hint is published for that read

  @unit
  Scenario: A burst of events for one read and tenant publishes one hint
    Given "organization.getScopeGraph" names "lw.project.created" scoped by "organizationId"
    When three projects are created in organization "acme" within one second
    Then the three share one deduplication id and wait one second, so one hint is published

  @unit
  Scenario: A hint that cannot be published is retried, never dropped
    Given Redis refuses the publish
    When the subscriber handles the event
    Then the handler fails so the subscriber lane retries the event

  # Delivery

  @unit
  Scenario: Presence relays a hint from the framework channel to its own tenant only
    Given presence's fan-out listening for read hints of tenants "acme" and "globex"
    When "{ path: organization.getScopeGraph }" arrives on "eventing:read_invalidated" for tenant "acme"
    Then only "acme" receives it, as a read hint

  @unit
  Scenario: A connection is sent the hints for its user, organization and project
    Given a stream opened by user "u1" in organization "acme" and project "p1"
    When hints arrive for tenants "u1", "acme" and "p1"
    Then the stream yields each hint's procedure path

  @unit
  Scenario: A connection is not sent a hint for another tenant
    Given a stream opened by user "u1" in organization "acme"
    When a hint arrives for organization "globex"
    Then the stream yields nothing

  @unit
  Scenario: A malformed broadcast frame is ignored
    Given a stream opened by user "u1" in organization "acme"
    When a frame arrives on its tenant that is not a hint
    Then the stream yields nothing and stays open

  @integration
  Scenario: A stream for an organization the caller does not belong to is refused
    Given a signed-in member of "acme"
    When they open the hint stream for organization "globex"
    Then the stream is refused

  @integration
  Scenario: A stream for a project outside the caller's organisation is refused
    Given a signed-in member of "acme"
    When they open the hint stream for organization "acme" and a project of "globex"
    Then the stream is refused

  @integration
  Scenario: An anonymous connection is refused the hint stream
    Given a request to the hint stream with no session
    When it opens
    Then it is refused and no hint is ever delivered on it

  # Browser

  @unit
  Scenario: Only a visible tab holds the hint stream
    Given a visible tab
    Then it holds one hint stream
    And it still holds it and fetches when its window loses focus
    When the tab is hidden
    Then its stream is closed and none is open
    When it is shown again
    Then it holds one hint stream again

  @unit
  Scenario: A hint refetches the mounted reads of its procedure and no others
    Given a visible tab has "organization.getScopeGraph" and "project.getAll" mounted
    When a hint for "organization.getScopeGraph" arrives
    Then "organization.getScopeGraph" is refetched
    And "project.getAll" is not

  @unit
  Scenario: A hint is passed to the other tabs, which mark the read stale without fetching
    Given a visible tab receives a hint for "organization.getScopeGraph"
    Then it posts the procedure path on the query sync channel, never data
    And a hidden tab holding that read marks it stale without fetching

  @unit
  Scenario: A reopened stream leaves fresh reads alone
    Given a visible tab has reads mounted and fresh
    When its hint stream reopens
    Then nothing is refetched

  @unit
  Scenario: A malformed hint is ignored
    Given a visible tab has "organization.getScopeGraph" mounted
    When the stream delivers a hint with no procedure path
    Then nothing is refetched and nothing is posted to the other tabs

  @unit
  Scenario: A tab without a broadcast channel still refetches on a hint
    Given a browser that refuses a broadcast channel
    When a visible tab receives a hint for "organization.getScopeGraph"
    Then "organization.getScopeGraph" is refetched

  # Default

  @unit
  Scenario: A read is trusted for five minutes and refetched on focus only when stale
    Given the browser's query client
    Then a read stays fresh for 5 minutes
    And a stale read is refetched when the tab regains focus or the network reconnects
    And no read is refetched on an interval
