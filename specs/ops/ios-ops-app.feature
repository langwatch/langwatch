Feature: LangWatch Ops for iOS
  As a platform operator away from my desk
  I want the ops dashboard on my phone
  So that I can see what the platform is doing and how far behind it is

  Context: the ops surfaces — dashboard, queues, dead letters, anomalies,
  scheduler, the Foundry, the payload store and projection replay — exist only
  as web pages behind a browser session. This feature is a native iOS client
  over the mobile ops API (see mobile-ops-api.feature). It monitors; it does not
  operate. The single action it can take is the payload store sweep, and even
  that is trialled first.

  # ---------------------------------------------------------------------------
  # Signing in
  # ---------------------------------------------------------------------------

  @manual
  Scenario: First launch asks which instance to talk to
    Given the app has never been signed in
    When it launches
    Then it asks for the LangWatch instance URL
    And it offers the production instance as the default

  @manual
  Scenario: Signing in uses the device authorization flow
    Given an operator has entered their instance URL
    When they start sign-in
    Then the app shows a short user code
    And it opens the instance's verification page in a browser
    And it polls until the operator approves in the browser
    And on approval it stores the issued tokens in the keychain

  @manual
  Scenario: The stored session survives relaunch
    Given an operator signed in previously
    When they relaunch the app
    Then they land on the dashboard without signing in again

  @unit
  Scenario: An expired access token is refreshed before the request is retried
    Given the stored access token has expired
    And the stored refresh token is still valid
    When any screen loads
    Then the app trades the refresh token for a fresh pair
    And it retries the request once with the new token

  @unit
  Scenario: A refusal from the server signs the operator out
    Given the stored refresh token has been revoked
    When any screen loads
    Then the app clears the keychain
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
    And the throughput history is drawn as a chart

  @manual
  Scenario: The dashboard refreshes on its own and on demand
    Given the operator is on the dashboard
    Then it refreshes periodically while it is on screen
    And pulling down refreshes it immediately
    And it stops refreshing when the app is backgrounded

  @unit
  Scenario: A stale snapshot is labelled rather than presented as live
    Given the last successful refresh was some time ago
    Then the dashboard says how old the figures are

  # ---------------------------------------------------------------------------
  # Queues
  # ---------------------------------------------------------------------------

  @manual
  Scenario: Queues are ranked by how much trouble they are in
    When the operator opens queues
    Then queues with blocked groups sort above healthy ones

  @manual
  Scenario: A queue drills down to its groups and a group to its jobs
    Given a queue with blocked groups
    When the operator opens that queue
    Then its groups are listed with their pending jobs and age
    And opening a blocked group shows the error that blocked it
    And opening a group shows the jobs waiting in it

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
    Then the app reports how many blobs would be reclaimed and how many bytes
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
  Scenario: The reclaim button stays disabled until the confirmation matches
    Given the reclaim confirmation sheet is open
    When the typed text does not match the confirmation word
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

  @manual
  Scenario: An ops module that is not running is reported, not shown as zero
    Given the instance is running without the ops module
    When the operator opens queues
    Then the screen says the ops module is unavailable on this instance
