Feature: LangWatch Ops mobile app
  As a platform operator away from my desk
  I want the ops dashboard on my phone
  So that I can see what the platform is doing and how far behind it is

  Context: an Expo / React Native client (targeting iOS; Android falls out of the
  same source) over the mobile tRPC mount — see mobile-ops-api.feature. Because
  it is TypeScript it consumes `MobileRouter` directly, so every screen is typed
  off the real procedures and a server-side change that would break a screen
  breaks the typecheck instead.

  It monitors. The single action it can take is the payload store cleanup sweep,
  and even that is trialled first.

  # ---------------------------------------------------------------------------
  # Signing in
  # ---------------------------------------------------------------------------

  @manual
  Scenario: First launch asks which instance to talk to
    Given the app has never been signed in
    When it launches
    Then it asks for the LangWatch instance URL
    And it offers the production instance as the default

  @unit
  Scenario: The instance address is taken as typed or as pasted
    Given an operator types a bare hostname, or pastes a full ops URL
    When the address is resolved
    Then both produce the same instance origin
    And an address that is not usable is rejected before any request is made

  @manual
  Scenario: Signing in uses the device authorization flow
    Given an operator has entered their instance URL
    When they start sign-in
    Then the app shows a short user code
    And it opens the instance's verification page in a browser
    And it polls until the operator approves in the browser
    And on approval it stores the issued tokens in the device keystore

  @manual
  Scenario: The stored session survives relaunch
    Given an operator signed in previously
    When they relaunch the app
    Then they land on the dashboard without signing in again

  @unit
  Scenario: An expired access token is refreshed before the request is sent
    Given the stored access token has expired
    And the stored refresh token is still valid
    When any screen loads
    Then the app trades the refresh token for a fresh pair
    And the request carries the new token

  @unit
  Scenario: Concurrent screens share one refresh
    Given several screens load at the same moment with an expired token
    When each of them needs a credential
    Then exactly one refresh is performed
    And all of them use its result
    Because the server rotates the refresh token on every use

  @unit
  Scenario: A refusal from the server signs the operator out
    Given the stored refresh token has been revoked
    When any screen loads
    Then the app clears the stored session
    And it returns to the sign-in screen

  @manual
  Scenario: A signed-in user without ops access is told so plainly
    Given an operator whose account has no ops access
    When they sign in
    Then the app says their account cannot see ops
    And it offers to sign out rather than showing empty screens

  # ---------------------------------------------------------------------------
  # Navigation
  # ---------------------------------------------------------------------------

  @manual
  Scenario: Every ops surface is reachable from the app
    Given a signed-in operator
    When they open the app
    Then they can reach the dashboard
    And they can reach queues
    And they can reach dead letters
    And they can reach anomalies
    And they can reach the scheduler
    And they can reach the Foundry
    And they can reach the payload store
    And they can reach projection replay

  @manual
  Scenario: The blocked and dead-lettered counts are visible without opening a screen
    Given groups are blocked and others are dead-lettered
    When the operator looks at the app
    Then a badge shows the combined count

  # ---------------------------------------------------------------------------
  # Dashboard
  # ---------------------------------------------------------------------------

  @manual
  Scenario: The dashboard leads with what is wrong
    Given a signed-in operator on the dashboard
    Then blocked groups, dead letters and counter drift are shown first
    And throughput, latency and Redis pressure follow

  @manual
  Scenario: The dashboard refreshes on its own and on demand
    Given the operator is on the dashboard
    Then it refreshes periodically while it is on screen
    And pulling down refreshes it immediately
    And it stops refreshing when the app is backgrounded

  @unit
  Scenario: A dashboard with no collection cycle yet says so
    Given the collector has not completed a cycle
    Then the screen says the figures are not live yet
    And it does not present a quiet platform as a healthy one

  # ---------------------------------------------------------------------------
  # Queues
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Queues are ranked by how much trouble they are in
    Given one queue with blocked groups and another with a larger backlog
    When the queue list is ordered
    Then the blocked queue sorts first
    Because a backlog drains on its own and a block does not

  @manual
  Scenario: A queue drills down to its groups and a group to its jobs
    Given a queue with blocked groups
    When the operator opens that queue
    Then its groups are listed with their pending jobs and age
    And opening a blocked group shows the error that blocked it
    And opening a group shows the jobs waiting in it

  @manual
  Scenario: Job payloads never reach the phone
    Given a group whose jobs carry customer payloads
    When the operator opens that group
    Then each job shows its size and the top-level keys of its payload
    And no payload contents are shown or fetched

  @manual
  Scenario: Paused keys and tenants are shown as state, not as controls
    Given a paused pipeline key and a paused tenant
    When the operator opens the queue
    Then both are listed as read-only state

  # ---------------------------------------------------------------------------
  # Dead letters, errors and anomalies
  # ---------------------------------------------------------------------------

  @manual
  Scenario: Dead-lettered groups are listed newest first with their error
    When the operator opens dead letters
    Then every dead-lettered group is listed across all queues
    And each shows its queue, its error and when it was dead-lettered

  @manual
  Scenario: Top errors are grouped so one incident reads as one row
    When the operator opens top errors
    Then each row is one clustered error with its count
    And opening a row shows a sample message, its stack and sample group ids

  @manual
  Scenario: Anomalies show the tenant and how far off baseline it is
    When the operator opens anomalies
    Then hard-tier anomalies are listed first
    And each shows the tenant, its current rate against baseline, and the reason

  @unit
  Scenario: A tenant with no baseline shows no multiple
    Given an anomaly on a tenant that had no traffic before
    Then no multiple-of-baseline figure is shown
    And nothing on the screen reads as infinity

  # ---------------------------------------------------------------------------
  # Scheduler and the Foundry
  # ---------------------------------------------------------------------------

  @manual
  Scenario: The scheduler shows what fires next and what is stuck
    When the operator opens the scheduler
    Then each schedule shows its cron, its next run and whether it is active
    And a schedule with a rising attempt count and a last error is called out

  @manual
  Scenario: The Foundry is a catalog on the phone
    When the operator opens the Foundry
    Then the built-in presets are listed with their descriptions
    And opening one shows the span tree it would generate
    And nothing in the screen emits a trace

  # ---------------------------------------------------------------------------
  # Payload store
  # ---------------------------------------------------------------------------

  @manual
  Scenario: The payload store opens on where the bytes are
    When the operator opens the payload store
    Then each queue shows its sampled blobs, sampled bytes and unreferenced count

  @manual
  Scenario: Blobs can be ordered by what the operator is hunting for
    Given the operator is browsing a queue's blobs
    Then they can order by largest, stalest, unreferenced or longest-lapsed lease
    And they can filter to a single project
    And a ranked order says it ranked a sample rather than the whole keyspace

  @manual
  Scenario: A blob shows its retention state and never its contents
    When the operator opens a blob
    Then it shows size, time to live, live leases and holder tokens
    And it shows what a sweep would decide for it
    And it never shows the payload

  @manual
  Scenario: A reclaim is trialled before it is run
    Given the operator wants to reclaim space
    When they run a trial sweep
    Then the app reports how many payloads would be reclaimed
    And it shows the breakdown per queue
    And nothing has been deleted

  @manual
  Scenario: Running the reclaim for real takes a typed confirmation
    Given the operator has seen a trial result
    When they choose to reclaim for real
    Then the app requires them to type the confirmation word
    And only then does it run the sweep
    And it reports what was actually reclaimed

  @unit
  Scenario: The reclaim action stays disabled until the confirmation matches exactly
    Given the reclaim sheet is open
    When the typed text differs in any character or in case
    Then the reclaim action is disabled

  # ---------------------------------------------------------------------------
  # Projection replay
  # ---------------------------------------------------------------------------

  @manual
  Scenario: Projections are browsable
    When the operator opens projection replay
    Then every registered projection is listed with its pipeline and aggregate type
    And every event subscriber is listed with the events it listens to

  @manual
  Scenario: A running replay shows its progress
    Given a replay is running
    When the operator opens projection replay
    Then it shows the projection being rebuilt and the phase
    And it shows aggregates processed against the total

  @unit
  Scenario: A replay whose total is not yet known shows an indeterminate progress
    Given a running replay that has not counted its aggregates yet
    Then the screen does not show a bar stuck at zero per cent

  @manual
  Scenario: Past replays are listed with their outcome
    When the operator opens replay history
    Then each past run shows who started it, what it covered and how it ended

  @manual
  Scenario: The app cannot start a replay
    When the operator looks at any projection screen
    Then there is no control that starts or cancels a replay

  # ---------------------------------------------------------------------------
  # Behaviour under failure
  # ---------------------------------------------------------------------------

  @manual
  Scenario: A screen that cannot load says why and offers a retry
    Given the instance is unreachable
    When the operator opens any screen
    Then the screen explains that it could not reach the instance
    And it offers a retry

  @unit
  Scenario: A retry is only offered when retrying could help
    Given a failure that no retry can fix, such as the account lacking ops access
    Then the screen explains it without offering a retry

  @manual
  Scenario: An ops module that is not running is reported, not shown as zero
    Given the instance is running without the ops module
    When the operator opens queues
    Then the screen says the ops module is unavailable on this instance
