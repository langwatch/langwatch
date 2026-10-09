# The operator's only act is changing the image. The new api runs the blocking part of the upgrade
# itself, behind the holding page; on failure the holding page becomes an upgrade console gated by
# a one-time token printed in the api's log. Background steps finish in the app (Ops > Upgrades,
# the last section; the ops module owns those screens and their retry write).
# Ruling: Alex, 2026-10-09 (UPGRADE-FIXES). Design: the "Proposed flow" of the upgrade review.
# The holding page itself: packages/process/specs/upgrade-holding-page.feature.

Feature: The new image runs its blocking upgrade behind a holding page
  As an operator of a self-hosted install
  I want to change the image and have the app upgrade itself, and to fix a failed upgrade in the app
  So that I never run a command inside a container and never see a connection refused

  # --- The blocking part runs in the api, behind the holding page ---

  @integration
  Scenario: The api on an installation behind its image runs the upgrade once, then serves
    Given an installation whose ledger records a blocking step of this image as pending
    When the api's gate asks
    Then it runs the upgrade once and asks again
    And it is admitted when the upgrade succeeded

  @unit
  Scenario: The api says it runs the upgrade because the installation is behind, naming the steps
    Given an api whose installation is behind its image on one blocking step
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
  Scenario: The worker never runs the upgrade when its installation is behind
    Given an installation whose ledger records a blocking step of this image as pending
    When the worker's gate asks
    Then it refuses, naming `pnpm task upgrade`, and runs nothing

  @unimplemented
  Scenario: The worker waits for the api's upgrade instead of exiting
    Given an installation behind the worker's image
    When the worker's gate asks
    Then it waits and asks again every 10 seconds
    And it starts taking jobs once the installation is current

  @unimplemented
  Scenario: The holding page names the upgrade's phase and its progress
    Given the api is running the upgrade and is applying the second of five blocking steps
    When a browser requests any page
    Then the holding page names the phase and "2 of 5"
    And it names no tenant, error, hostname or version

  @unimplemented
  Scenario: A second api waits for the upgrade lease behind the holding page
    Given one api holds the upgrade lease and runs the upgrade
    When a second api's gate finds its installation behind
    Then the second api's holding page says it waits for another process's upgrade
    And it serves once the first api's upgrade succeeded

  @unimplemented
  Scenario: Compose and npx start the app without a separate migrate step
    Given a compose stack or an npx server on an installation behind the new image
    When the operator starts it
    Then the browser sees the holding page while the upgrade runs, not a refused connection

  # --- On failure: the upgrade console, behind a one-time token ---
  # Rulings: Alex, 2026-10-09 (UPGRADE-CONSOLE): token in api memory as SHA-256, 30 min, once,
  # swapped for a console cookie; 5 wrong tokens a minute; only the console's Retry runs again.

  @unit
  Scenario: A failed upgrade keeps the api holding the door and prints a console token to its log
    Given the api's upgrade fails on a blocking step
    When the run ends
    Then the api keeps running and holds the door
    And it prints one console token to its log with how to open the console
    And the token appears in no page, header, URL or other log line

  @unit
  Scenario: The holding page of a failed upgrade asks for the token and shows no failure detail
    Given the api's upgrade failed
    When a browser requests any page
    Then it answers 503 with a page saying the upgrade needs an operator and asking for the token
    And it names no step, error, hostname or version

  @unit
  Scenario: The right token opens the upgrade console
    Given the api's upgrade failed and printed a console token
    When an operator submits that token in the request body
    Then the browser keeps an HttpOnly, SameSite=Strict console cookie in place of the token
    And the console shows the failed step, its error and the last 50 lines of the run's log
    And it offers Retry

  @unit
  Scenario: Five wrong tokens in a minute make every submission wait
    Given the api's upgrade failed and printed a console token
    When five wrong tokens were submitted within a minute
    Then the next submission is answered 429, even with the right token

  @unit
  Scenario: A wrong token is refused without detail
    Given the api's upgrade failed and printed a console token
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
  Scenario: Retry from the console runs the upgrade again and serves on success
    Given an operator opened the console of a failed upgrade
    When the operator presses Retry and the upgrade succeeds
    Then the api serves
    And the console and its token no longer answer

  @unit
  Scenario: A retry that fails again keeps the console and names the new failure
    Given an operator opened the console of a failed upgrade
    When the operator presses Retry and the upgrade fails again
    Then the console shows the new failure and offers Retry again

  @unit
  Scenario: A console action without the console session is refused
    Given the api's upgrade failed
    When a request asks for Retry without the session the token opened
    Then it is refused and no upgrade runs

  @unit
  Scenario: Liveness still answers while the console is shown
    Given the api's upgrade failed and shows the console
    When the kubelet requests the liveness path
    Then it answers 200

  # The background part (Ops > Upgrades): modules/ops/specs/upgrades.feature.
