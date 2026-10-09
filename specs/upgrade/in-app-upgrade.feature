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

  @unimplemented
  Scenario: A failed upgrade keeps the api holding the door and prints a console token to its log
    Given the api's upgrade fails on a blocking step
    When the run ends
    Then the api keeps running and holds the door
    And it prints one console token to its log with how to open the console
    And the token appears in no page, header, URL or other log line

  @unimplemented
  Scenario: The holding page of a failed upgrade asks for the token and shows no failure detail
    Given the api's upgrade failed
    When a browser requests any page
    Then it answers 503 with a page saying the upgrade needs an operator and asking for the token
    And it names no step, error, hostname or version

  @unimplemented
  Scenario: The right token opens the upgrade console
    Given the api's upgrade failed and printed a console token
    When an operator submits that token in the request body
    Then the console shows the failed step, its error, its fix and the last 50 lines of the run's log
    And it offers Retry and "Mark the migration rolled back and retry"
    And it says that setting the previous version back also serves this schema

  @unimplemented
  Scenario: A wrong token is refused without detail
    Given the api's upgrade failed and printed a console token
    When someone submits a different token
    Then it is refused with the same answer an expired token gets
    And the console stays closed

  @unimplemented
  Scenario: An expired token is refused
    Given a console token printed longer ago than the token's lifetime
    When an operator submits it
    Then it is refused and the page says how to get a new token

  @unimplemented
  Scenario: A token opens the console once
    Given an operator opened the console with the printed token
    When the same token is submitted again
    Then it is refused with the same answer an expired token gets

  @unimplemented
  Scenario: Retry from the console runs the upgrade again and serves on success
    Given an operator opened the console of a failed upgrade
    When the operator presses Retry and the upgrade succeeds
    Then the api serves
    And the console and its token no longer answer

  @unimplemented
  Scenario: A retry that fails again keeps the console and names the new failure
    Given an operator opened the console of a failed upgrade
    When the operator presses Retry and the upgrade fails again
    Then the console shows the new failure and offers Retry again

  @unimplemented
  Scenario: A console action without the console session is refused
    Given the api's upgrade failed
    When a request asks for Retry without the session the token opened
    Then it is refused and no upgrade runs

  @unimplemented
  Scenario: Liveness still answers while the console is shown
    Given the api's upgrade failed and shows the console
    When the kubelet requests the liveness path
    Then it answers 200

  # --- Background part: Ops > Upgrades, "Finishing in background" ---

  @unimplemented
  Scenario: The background step list shows each step's state, progress and deadline
    Given a background step at 63 percent, one waiting on old writers and one failed
    When an operator opens "Finishing in background"
    Then each step shows its id, status and progress from its checkpoint report
    And each shows the release it must finish before
    And the waiting step names the processes it waits on by role, image and last seen

  @unimplemented
  Scenario: A failed background step offers Retry to a manager
    Given a background step that failed
    When an operator holding ops:manage opens the list
    Then the failed step offers Retry

  @unimplemented
  Scenario: Retry sets a failed step pending and the worker runs it again
    Given a background step that failed
    When an operator holding ops:manage retries it
    Then the ledger records the step as pending
    And the worker runs it again from its checkpoint

  @unimplemented
  Scenario: A view-only operator sees the list and no Retry
    Given a background step that failed
    When an operator holding ops:view only opens the list
    Then the step shows as failed with its error
    And no Retry is offered

  @unimplemented
  Scenario: Retry without ops:manage is refused by the door
    Given a background step that failed
    When a caller without ops:manage asks to retry it
    Then the door refuses it as forbidden and the step stays failed

  @unimplemented
  Scenario: Retrying a step that is not failed is refused
    Given a background step that is running
    When an operator holding ops:manage asks to retry it
    Then it is refused as a conflict naming the step's status
    And the step keeps running

  @unimplemented
  Scenario: Retrying a step the ledger does not hold says it was not found
    Given no step with the id asked for
    When an operator holding ops:manage asks to retry it
    Then it is refused as not found
