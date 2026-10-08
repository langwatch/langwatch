# The serving gate: dev/docs/plans/migrations-blitz-2026-10-06.md sections 3.1 and 3.2,
# deltas D5 and Q-U5 (1); rethink 6.7 ("serving processes never migrate and never wait").
#
# An api or worker reads the upgrade ledger once its stores are open and before its
# application runs. It refuses to start, by name, when a blocking step its image declares is
# not done or not-needed, or when its release is below the highest floor any upgrade run
# recorded. Admitted, it writes its roster entry and refreshes it until a graceful stop removes it.
# The tasks role runs `upgrade` and is never gated. On a Helm first install (empty ledger, empty
# schema) the api detects it; running `upgrade` then is mig-entry-points' (Q10).

Feature: Serving processes refuse to start when the installation is behind their image
  As an operator upgrading a LangWatch installation
  I want an api or worker built for a newer schema to refuse to start, naming what is missing
  So that no process ever serves on a schema it was not built for

  Background:
    Given an image for release "3.21.0" declaring blocking steps "prisma:20261006180000_add_column" and "clickhouse:00042"

  @unit
  Scenario: A process whose blocking steps are all done serves
    Given the ledger records "prisma:20261006180000_add_column" as done and "clickhouse:00042" as not-needed
    When the serving gate checks the image
    Then the process is admitted

  @unit
  Scenario: A process behind the ledger refuses, naming the outstanding steps and the command
    Given the ledger records "prisma:20261006180000_add_column" as done and "clickhouse:00042" as failed
    When the serving gate checks the image
    Then the process is refused
    And the refusal names step "clickhouse:00042" and the command "pnpm task upgrade"

  @unit
  Scenario: A blocking step the ledger has never recorded is outstanding
    Given the ledger records only "prisma:20261006180000_add_column" as done
    When the serving gate checks the image
    Then the process is refused
    And the refusal names step "clickhouse:00042"

  @unit
  Scenario: An image below the ledger's floor refuses, naming the floor
    Given an upgrade run recorded the floor "3.22.0"
    And every blocking step the image declares is done
    When the serving gate checks the image
    Then the process is refused
    And the refusal names release "3.21.0" and floor "3.22.0"

  @unit
  Scenario: A rolled-back image at or above the floor serves
    Given upgrade runs recorded the floors "3.20.1" and "3.21.0"
    And every blocking step the image declares is done
    When the serving gate checks the image
    Then the process is admitted

  @unit
  Scenario: An unreleased cloud image is never below the floor
    Given an image with no release, built as "git-abc1234"
    And an upgrade run recorded the floor "3.22.0"
    And every blocking step the image declares is done
    When the serving gate checks the image
    Then the process is admitted

  @unit
  Scenario: An image with a malformed release is refused before it reads the ledger
    When a serving gate is made for release "3.21"
    Then making it fails, naming the release

  @unit
  Scenario: A Helm first install is detected by the api
    Given the ledger has no steps and no runs
    And the application schema is empty
    When the api's serving gate checks the image
    Then the verdict is a first install naming the command "pnpm task upgrade"

  @unit
  Scenario: A worker on a first install refuses as behind
    Given the ledger has no steps and no runs
    And the application schema is empty
    When the worker's serving gate checks the image
    Then the process is refused
    And the refusal names step "clickhouse:00042"

  @unit
  Scenario: A ledger that cannot be read refuses the start
    Given reading the ledger fails with "connection refused"
    When the process starts serving with the gate composed
    Then starting fails, naming the role and "connection refused"
    And the application never starts

  @unit
  Scenario: A refused process never starts its application
    Given a gate that refuses with "behind: clickhouse:00042; run pnpm task upgrade"
    When the process starts serving with the gate composed
    Then starting fails with code "upgrade_gate_refused", naming the refusal
    And the application never starts

  @unit
  Scenario: An admitted process asks the gate before its application starts
    Given a gate that admits
    When the process starts serving with the gate composed
    Then the gate was asked before the application started

  @unit
  Scenario: The tasks role is never gated
    When a tasks process composes the serving gate
    Then composing it fails, naming the tasks role

  @unit
  Scenario: The roster entry is written on start and removed on graceful stop
    Given every blocking step the image declares is done
    When the worker's serving gate admits it
    Then the roster entry names the worker, its image, its release and its declared steps
    When the process stops gracefully
    Then the roster entry is removed after the application stopped

  @unit
  Scenario: A refused process writes no roster entry
    Given the ledger records "clickhouse:00042" as pending
    When the serving gate checks the image
    Then no roster entry is written

  # Lapsed gate (round 9): a process whose own roster entry lapses stops serving, so it cannot
  # serve unseen while a step waits on old writers being gone (ADR-173, Consequences).
  @unit
  Scenario: A process whose roster writes keep failing stops serving past the stale bound
    Given a worker was admitted and recorded its roster entry
    And the ledger refuses every later roster write
    When more than 60 seconds pass since its last good roster write
    Then the gate says the worker is not serving
    And the change is reported once

  @unit
  Scenario: A process that stopped serving on a lapsed roster entry serves again after a good write
    Given a worker stopped serving because its roster entry lapsed
    When the next roster write succeeds
    Then the gate says the worker is serving
    And the change is reported once

  @unit
  Scenario: A healthy process never stops serving
    Given a worker was admitted and every roster write succeeds
    When ten minutes pass
    Then the gate says the worker is serving throughout

  @unit
  Scenario: A process that is not admitted is not serving
    Given the ledger records "clickhouse:00042" as pending
    When the serving gate checks the image
    Then the gate says the worker is not serving


  # Stop serving (round 22): a lapse turns /readyz 503 so the load balancer drains the process,
  # and a worker pauses taking jobs; both resume after a good roster write.
  @unit
  Scenario: Readiness fails while the roster entry is lapsed and passes again after a good write
    Given an admitted process whose readiness passed and latched
    When its gate stops serving
    Then the next readiness probe answers 503 naming the lapsed roster entry
    And when its gate serves again the next readiness probe answers 200

  @unit
  Scenario: A worker pauses taking jobs while its roster entry is lapsed and resumes after a good write
    Given an admitted worker running its application
    When its gate stops serving
    Then every runtime service that can pause is paused
    And when its gate serves again every paused service resumes

  @unit
  Scenario: The worker's runtime pauses and resumes its eventing consumers
    Given a booted runtime whose eventing host can pause its consumers
    When the runtime is told to hold its work, then to release it
    Then the eventing host pauses its consumers, then resumes them

  @unit
  Scenario: Roster entries dead for longer than the prune bound are deleted when a process records its own
    Given a roster entry last written longer ago than the prune bound and one dead for less
    When a process records its roster entry
    Then the long-dead entry is deleted and the recently dead one is kept

  @unit
  Scenario: A failed prune never refuses the start
    Given a roster whose prune is refused
    When a process records its roster entry
    Then its entry is written and the failure is reported

  @unit
  Scenario: The gate reads the image's generated code step list
    Given the image's generated code step list holds a blocking step and a background step
    When an api or worker builds its gate from the image tree
    Then the blocking step is required before the process serves
    And the background step is declared on its roster entry

  @integration
  Scenario: A serving process over a real ledger gates on the generated code step list
    Given the image's committed code step list and every schema step done
    When a worker's gate reads the ledger while the list's blocking step is pending
    Then it is refused naming that step
    And once that step is done the api is admitted and its roster entry declares the background steps

  @integration
  Scenario: The api and worker declare the code steps the tasks process collects
    Given the tasks process's installed modules booted over memory stores
    When `pnpm task upgrade steps --json` lists their migration steps
    Then the image's generated code step list, as the api and worker read it, names the same ids, kinds and modes in the same order
