Feature: Mobile ops API
  As an operator carrying a phone instead of a laptop
  I want a JSON API that mirrors what the ops dashboard shows
  So that a native client can monitor the platform without a browser session

  Context: every ops surface today is reachable only through tRPC procedures
  authenticated by a browser session cookie and encoded with superjson. A native
  app cannot hold that cookie and should not have to decode that envelope, so
  this feature adds a plain-JSON read surface at /api/ops/mobile/* that reuses
  the SAME app-layer ops services and the SAME ops:view / ops:manage gate the
  web surface goes through. Nothing here is a second implementation of an ops
  query — it is a second transport in front of the existing one.

  The surface is read-only with exactly one exception: the payload-store
  cleanup sweep, which an operator explicitly asked to be able to trial and then
  run. Everything that starts long-running or destructive work elsewhere in ops
  — projection replays, DLQ redrives, unblocks, drains, tenant pauses, feature
  flag writes — is deliberately absent, because a phone is the wrong place to
  hold a destructive control and their absence is a security property, not an
  omission.

  # ---------------------------------------------------------------------------
  # Authentication and authorization
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A request without credentials is rejected
    Given a mobile client with no access token
    When it requests any mobile ops endpoint
    Then the response is 401
    And no ops data is returned

  @integration
  Scenario: A request carrying a session cookie instead of a token is rejected
    Given a mobile client presenting only a browser session cookie
    When it requests the dashboard endpoint
    Then the response is 401

  @integration
  Scenario: A device-flow access token authenticates the caller
    Given an operator has completed the device authorization flow
    And the app holds the issued access token
    When it requests the dashboard endpoint with that token as a bearer credential
    Then the response is 200
    And the body carries the current dashboard metrics

  @integration
  Scenario: An expired access token is rejected
    Given the app holds an access token whose lifetime has passed
    When it requests the dashboard endpoint
    Then the response is 401
    And the stored token is discarded

  @integration
  Scenario: A signed-in user without ops access is refused
    Given an authenticated user who is not on the platform operator list
    When they request any mobile ops endpoint
    Then the response is 403
    And the body explains that ops access is required

  @integration
  Scenario: The scope endpoint reports access without failing for non-operators
    Given an authenticated user who is not on the platform operator list
    When the app requests the scope endpoint
    Then the response is 200
    And the body reports that the user has no ops access
    And the app can hide every ops surface without provoking an error

  # ---------------------------------------------------------------------------
  # Dashboard — the stats screen
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The dashboard reports the same snapshot the web dashboard renders
    Given the metrics collector has completed a collection cycle
    When the app requests the dashboard endpoint
    Then the body reports total groups, blocked groups and parked groups
    And it reports pending jobs and the counter drift from the last reconcile
    And it reports completed, failed and ingested throughput with their peaks
    And it reports latency at the median and the 99th percentile
    And it reports per-phase metrics for commands, projections and reactions
    And it reports Redis memory, connected clients and engine CPU
    And it reports the throughput history the chart is drawn from
    And it reports the queue summaries, the paused keys and the top errors

  @integration
  Scenario: The dashboard is available before the first collection cycle
    Given the metrics collector has not yet completed a cycle
    When the app requests the dashboard endpoint
    Then the response is 200
    And the body reports that no snapshot is available yet

  @integration
  Scenario: The badge endpoint stays cheap enough to poll
    When the app requests the badge endpoint
    Then the body carries only the blocked group count and the DLQ job count
    And the full dashboard aggregation is not performed

  # ---------------------------------------------------------------------------
  # Queues — how processing is going
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The queue list reports each queue's backlog
    When the app requests the queues endpoint
    Then each queue reports its pending, blocked, active and parked group counts
    And each queue reports its total pending jobs and its DLQ count

  @integration
  Scenario: Groups are listed a page at a time
    Given a queue with more groups than fit in one page
    When the app requests the groups of that queue
    Then a bounded page of groups is returned
    And each group reports whether it is blocked, its pending jobs and its age
    And a blocked group reports the error message that blocked it

  @integration
  Scenario: A group's jobs can be inspected without shipping their payloads
    Given a group with queued jobs carrying customer payloads
    When the app requests that group's jobs
    Then a bounded page of jobs is returned
    And each job reports its id, its score and the size of its payload
    And each job reports the top-level keys of its payload
    And no payload contents are returned

  @integration
  Scenario: The blocked summary reports where the backlog is concentrated
    When the app requests the blocked summary
    Then the response groups blocked work so an operator can see the worst queue first

  @integration
  Scenario: Paused keys and paused tenants are visible
    Given a pipeline key and a tenant have been paused by an operator
    When the app requests the paused keys of that queue
    And the app requests the paused tenants of that queue
    Then both pauses are reported
    And the app offers no way to pause or unpause from the phone

  # ---------------------------------------------------------------------------
  # Dead letter queue, errors and anomalies
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Every dead-lettered group is listed across all queues
    Given groups have been dead-lettered in more than one queue
    When the app requests the dead letter endpoint
    Then every dead-lettered group is returned with its queue and error
    And the most recently dead-lettered group is first

  @integration
  Scenario: Top errors are clustered rather than listed one by one
    Given many groups failed with the same underlying error
    When the app requests the dashboard endpoint
    Then the top errors report one cluster per normalized message
    And each cluster reports its count, its queue and sample group ids

  @integration
  Scenario: Active tenant anomalies are listed worst first
    Given a tenant has tripped the hard-tier rate breaker
    And another tenant has tripped the surface tier
    When the app requests the anomalies endpoint
    Then the hard-tier anomaly is listed first
    And each anomaly reports its tenant, current rate, baseline and reason

  # ---------------------------------------------------------------------------
  # Scheduler
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Scheduled jobs report what fires next and what last failed
    When the app requests the scheduler endpoint
    Then each scheduled job reports its cron, its timezone and its next run
    And a job being worked reports the slot it is working
    And a failing job reports its attempt count and its last error
    And the app offers no way to fire, pause or edit a schedule

  # ---------------------------------------------------------------------------
  # The Foundry
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The Foundry preset catalog is readable from the phone
    When the app requests the foundry presets endpoint
    Then every built-in preset is returned with its name and description
    And each preset reports the shape of the trace it would generate
    And the app offers no way to emit a trace from the phone

  # ---------------------------------------------------------------------------
  # Payload store
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Payload store totals are reported per queue
    When the app requests the payload store stats endpoint
    Then each queue reports the blobs and bytes it sampled
    And each queue reports how many of those are unreferenced
    And a queue whose walk hit the sampling ceiling says so

  @integration
  Scenario: Blobs are listed with their retention state
    When the app lists blobs for a queue
    Then each blob reports its project, its size and its remaining time to live
    And each blob reports its live leases and its mirrored holder tokens
    And each blob reports what a sweep would decide for it right now
    And no blob body is ever returned

  @integration
  Scenario: A ranked listing admits that it ranked a sample
    Given a keyspace too large to sort inside one request
    When the app lists the largest blobs
    Then the page reports how many blobs it examined
    And the page reports that the order is a best-of-sample rather than a true top

  @integration
  Scenario: Blobs can be narrowed to one project
    Given blobs belonging to several projects
    When the app lists blobs filtered to one project
    Then only that project's blobs are returned

  @integration
  Scenario: A blob stranded by a dead worker is findable
    Given a blob whose lease holder stopped renewing some time ago
    When the app lists blobs ordered by longest-lapsed lease
    Then that blob is near the top
    And it reports how long ago its earliest lease deadline passed

  # ---------------------------------------------------------------------------
  # Reclaim — the one write
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A trial sweep reports what it would reclaim without touching anything
    Given unreferenced blobs past their grace window
    When the app runs a payload store sweep as a trial
    Then the report says how many blobs would be reclaimed, repaired and left pending
    And the report is broken down per queue
    And no blob is deleted

  @integration
  Scenario: A trial sweep needs no confirmation
    When the app runs a payload store sweep as a trial without a confirmation
    Then the response is 200

  @integration
  Scenario: A real sweep without a typed confirmation is refused
    When the app runs a payload store sweep for real without a confirmation
    Then the response is 400
    And nothing is reclaimed

  @integration
  Scenario: A real sweep with the typed confirmation reclaims and reports
    Given unreferenced blobs past their grace window
    When the app runs a payload store sweep for real with the typed confirmation
    Then the reclaimed blobs are deleted
    And the report says how many were reclaimed
    And the sweep is recorded against the operator who asked for it

  @integration
  Scenario: A sweep is refused to a viewer without manage rights
    Given a caller holding ops view but not ops manage
    When they run a payload store sweep for real
    Then the response is 403

  @integration
  Scenario: Deleting a single blob is not exposed to the phone
    When the app looks for an endpoint that deletes one blob
    Then no such endpoint exists on the mobile surface

  # ---------------------------------------------------------------------------
  # Projection replay — viewable, not startable
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The projection catalog is readable
    When the app requests the projections endpoint
    Then every registered projection is returned with its pipeline and aggregate type
    And every event subscriber is returned with the event types it listens to

  @integration
  Scenario: A running replay reports its progress
    Given a replay is running
    When the app requests the replay status endpoint
    Then the status reports the run, the projection being rebuilt and the phase
    And it reports aggregates processed against the total and events processed

  @integration
  Scenario: Past replays are listed with their outcome
    When the app requests the replay history endpoint
    Then each past run reports who started it, what it covered and how it ended

  @integration
  Scenario: A replay cannot be started or cancelled from the phone
    When the app looks for an endpoint that starts or cancels a replay
    Then no such endpoint exists on the mobile surface
    And the projection screens are presented as read-only

  # ---------------------------------------------------------------------------
  # Route registration
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Every mobile ops route declares an access policy
    When the API router is composed
    Then every mobile ops route appears in the route registry with a policy
