# The operator's only act is changing the image. The new worker runs every blocking upgrade step
# under the runner's lease (`pnpm task upgrade` as a child process); the new api never runs a step
# and holds no request: it serves every route from boot (NO-HOLDS, Alex 2026-10-09). A Postgres read
# the schema is not ready for answers upgrade_in_progress (503, Retry-After); a ClickHouse read leaves
# out a column a pending step has not added. Failures show on Ops > Upgrades with Retry; only a failed
# first install, which nobody can sign in to follow, opens the token console. Rulings: Alex,
# 2026-10-09 (UPGRADE-IN-WORKER, UIW-1..11; API-UP-DURING-UPGRADE; NO-HOLDS).
# The liveness door itself: packages/process/specs/upgrade-holding-page.feature.

Feature: The new image's worker runs its blocking upgrade while the api serves, then upgrades in the app
  As an operator of a self-hosted install
  I want to change the image and have the worker upgrade the installation, and follow or fix it in the app
  So that I never run a command inside a container and never see a connection refused

  # --- The blocking part runs in the worker, under the runner's lease ---

  @integration
  Scenario: The worker on an installation behind its image runs the upgrade once, then takes jobs
    Given an installation whose ledger records a blocking step of this image as pending
    When the worker's gate asks
    Then it takes the upgrade lease and runs `pnpm task upgrade` once as a child process
    And it takes no job before the ledger is current
    And it is admitted and starts its background steps when the upgrade succeeded

  @unit
  Scenario: The worker says it runs the upgrade because the installation is behind, naming the steps
    Given a worker whose installation is behind its image on one blocking step
    When its upgrade gate admits it
    Then it reports that the installation is behind, naming the step and "pnpm task upgrade"
    And the report says nothing is needed from the operator

  @unit
  Scenario: An image below the installation's floor runs nothing and refuses
    Given an api whose release is below the ledger's floor
    When its upgrade gate admits it
    Then it runs no upgrade
    And it refuses, naming the floor

  @integration
  Scenario: The api never runs the upgrade when its installation is behind
    Given an installation whose ledger records a blocking step of this image as pending
    When the api's gate asks
    Then it runs nothing and takes no upgrade lease
    And it serves every route at once and reports not ready until the ledger is current

  @unit
  Scenario: A worker waits while another runner holds the upgrade lease
    Given another worker or a `pnpm task upgrade` run holds the upgrade lease
    When a worker's gate finds its installation behind
    Then it runs nothing, treats the held lease as no failure and asks again every 10 seconds
    And it starts taking jobs once the installation is current

  @unimplemented
  Scenario: Two workers starting together run the upgrade once
    Given two workers of the new image start on an installation behind it
    When both gates ask
    Then one runs the upgrade and the other waits for it
    And both take jobs once the installation is current

  @unit
  Scenario: After a failed run the worker waits for a Retry
    Given the worker's upgrade run failed on a blocking step
    When its gate asks again
    Then the ledger records the step as failed and the worker runs nothing
    And once a Retry returns the step to pending the worker runs the upgrade again

  @unit
  Scenario: A restarted worker runs a failed upgrade once more
    Given the worker's upgrade run failed on a blocking step
    When the operator restarts the worker
    Then the new worker runs the upgrade once more
    And it waits for a Retry if that run fails too

  # --- The api serves throughout: Postgres reads say retry, ClickHouse reads skip pending columns ---

  @unit
  Scenario: A Postgres read the schema is not ready for answers upgrade_in_progress
    Given the worker is running the upgrade and a Postgres schema step of the api's image is pending
    When a handler's query names a table or column that step has not created
    Then REST answers 503 upgrade_in_progress with Retry-After
    And tRPC and SSE answer the same handled code

  @unit
  Scenario: The browser retries a read answered upgrade_in_progress
    Given the api answers a read upgrade_in_progress
    When the browser's query client decides whether to try again
    Then it keeps retrying with backoff past the usual retry limit

  @unit
  Scenario: A ClickHouse read leaves out a column a pending step has not added
    Given a ClickHouse schema step that adds a column is pending on a target
    When a repository selects that column through the column helper
    Then the query selects the column's typed default under its name instead
    And once the target's column list refreshes with the column, the query selects it

  # API-UP-DURING-UPGRADE (Alex, 2026-10-09): ingestion enqueues for the worker and is never dropped;
  # no blocking step touches an ingest table. Dev boot order: specs/setup/haven-local-topology.feature.
  @unimplemented
  Scenario: A trace posted during an upgrade appears once the worker finishes
    Given the api accepted an SDK's traces with 2xx while a blocking data step was outstanding
    And the api wrote no ClickHouse row for them: its spans were enqueued for the worker
    When the worker finishes the upgrade and takes jobs
    Then the trace appears, and no span the api accepted is missing
    # Proven end to end by tools/upgradelab's "no dropped traces" invariant (not landed).

  @unimplemented
  Scenario: The api's liveness answers in every phase
    Given the api is upgrading, showing the console or serving
    When the kubelet requests /api/health
    Then it answers 200

  @unit
  Scenario: The api serves and reports ready once the ledger is current
    Given the api is in upgrading mode
    When the worker's run records the last blocking step as done
    Then the api's gate sees the ledger current within 10 seconds
    And the api reports ready

  @unimplemented
  Scenario: The upgrading frame names the upgrade's phase and its progress
    Given the worker is applying the second of five blocking steps
    When a signed-in browser opens any page other than sign-in and Upgrades
    Then the upgrading frame names the phase and "2 of 5"
    And it names no tenant, error, hostname or version

  @integration
  Scenario: The Upgrades page opens once its grant read settles, even when no feature flag answers
    Given the api is in upgrading mode and a platform operator holds ops:view
    When the shell opens Ops > Upgrades before any feature flag read has answered
    Then the page opens on the grant read alone

  @unimplemented
  Scenario: A failed blocking step is retried from the Upgrades page
    Given the worker's run failed on a blocking step of either store while the api is upgrading
    When a platform operator with ops:manage presses Retry on that step
    Then the ledger returns the step to pending and the waiting worker runs the upgrade again
    And retrying a step that is not failed answers 409 upgrade_step_not_failed

  @unimplemented
  Scenario: Compose and npx start the app without a separate migrate step
    Given a compose stack or an npx server on an installation behind the new image
    When the operator starts it
    Then the worker runs the upgrade and the browser reaches the app at once, not a refused connection

  # --- On failure: the upgrade console, behind a one-time token ---
  # Rulings: Alex, 2026-10-09 (UPGRADE-CONSOLE): token in api memory as SHA-256, 30 min, once,
  # swapped for a console cookie; 5 wrong tokens a minute. UIW-7, NO-HOLDS: only for a failed first
# install, which nobody can sign in to follow on Ops > Upgrades.

  @unit
  Scenario: A failed first install shows the console and prints a console token to its log
    Given the worker's first install fails on a Postgres schema step
    When the api's gate reads the failure from the ledger
    Then the api keeps running and shows the console in front of every route but the health routes
    And it prints one console token to its log at warn level, with how to reach this pod and open the console
    And the token appears in no page, header, URL or other log line

  # Follow-ups: Alex, 2026-10-09 (CONSOLE-FOLLOWUPS).
  @unit
  Scenario: The console shows a failed run's errors and log lines with connection passwords redacted
    Given the upgrade fails with a connection URL carrying a password in a step error and the run report's log
    When the api shows the upgrade console
    Then the console shows the URL with its password replaced by ***

  @unit
  Scenario: A console session of an earlier failed run does not open the next run's console
    Given an operator opened the console and pressed Retry
    When the retried upgrade fails again and the console shows the new failure
    Then the earlier console session sees the token page and its Retry is refused

  @unit
  Scenario: A cross-site Retry is refused even with the console session
    Given an operator opened the console of a failed upgrade
    When a request carrying the console session posts Retry from another site or origin
    Then it is refused and no step returns to pending
    And a Retry from the console's own origin returns the failed step to pending

  @unit
  Scenario: The console of a failed first install asks for the token and shows no failure detail
    Given the first install failed
    When a browser requests any page
    Then it answers 503 with a page saying the upgrade needs an operator and asking for the token
    And it names no step, error, hostname or version

  @unit
  Scenario: The right token opens the upgrade console
    Given the first install failed and printed a console token
    When an operator submits that token in the request body
    Then the browser keeps an HttpOnly, SameSite=Strict console cookie in place of the token
    And the console shows the failed step, its error and the last 50 lines of the run's log
    And it offers Retry

  @unit
  Scenario: Five wrong tokens in a minute make every submission wait
    Given the first install failed and printed a console token
    When five wrong tokens were submitted within a minute
    Then the next submission is answered 429, even with the right token

  @unit
  Scenario: A token submitted from another site or origin is refused and not counted
    Given the first install failed and printed a console token
    When a page on another site or origin submits a token to the console
    Then it is refused, even with the right token, and no console cookie is set
    And it does not count towards the five wrong tokens a minute

  @unit
  Scenario: A wrong token is refused without detail
    Given the first install failed and printed a console token
    When someone submits a different token
    Then it is refused with the same answer an expired token gets
    And the console stays closed

  @unit
  Scenario: An expired token is refused
    Given a console token printed longer ago than the token's lifetime
    When an operator submits it
    Then it is refused and the page says how to get a new token

  @unit
  Scenario: A token opens the console once
    Given an operator opened the console with the printed token
    When the same token is submitted again
    Then it is refused with the same answer an expired token gets

  @unit
  Scenario: Retry from the console returns the failed step to pending and the api moves on when the worker's run succeeds
    Given an operator opened the console of a failed upgrade
    When the operator presses Retry and the worker's next run succeeds
    Then the ledger recorded the step as pending before the run
    And the console lifts and its token no longer answers

  @unit
  Scenario: The console shows the failure from the run report in the ledger
    Given the worker's upgrade failed on a Postgres schema step
    When the operator opens the console with the token
    Then the console shows the failed step, its error and the last 50 lines of the run report's log

  @unit
  Scenario: A failure on an installation that finished an upgrade before opens no console
    Given the worker's upgrade failed on a blocking step of an installation that finished an upgrade before
    When a browser requests any page
    Then it reaches the app, no token is asked for and no console token is printed
    And the failure shows on Ops > Upgrades with Retry

  @unit
  Scenario: A retry that fails again keeps the console and names the new failure
    Given an operator opened the console of a failed upgrade
    When the operator presses Retry and the upgrade fails again
    Then the console shows the new failure and offers Retry again

  @unit
  Scenario: A console action without the console session is refused
    Given the first install failed
    When a request asks for Retry without the session the token opened
    Then it is refused and no step returns to pending

  @unit
  Scenario: Liveness still answers while the console is shown
    Given the first install failed and shows the console
    When the kubelet requests the liveness path
    Then it answers 200

  # The background part (Ops > Upgrades): modules/ops/specs/upgrades.feature.
