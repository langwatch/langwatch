# Stuck states in the serving gate, the background runner and the reader (stuck-states review,
# section B). Each scenario is a way an upgrade could stop moving with nobody told what to do.
# The two @unimplemented scenarios wait on a ruling: what the api answers when the ledger and the
# schema disagree (B2), and how long a background step may run before the sweep moves on (B4).

Feature: An upgrade never sticks in the gate, the background runner or the status
  As an operator upgrading a LangWatch installation
  I want every failure to leave a way forward that the product names
  So that an upgrade never waits forever on something no Retry can clear

  # B1: the worker waits only on what a Retry can clear.
  @integration
  Scenario: A Retry of the failed blocking step frees the worker while another failed row stays
    Given a worker whose upgrade failed on a blocking step of its image
    And the ledger also records a failed step outside the image's blocking steps
    When the failed blocking step is retried
    Then the worker runs the upgrade again without waiting on the other failed row
    And it takes jobs once the upgrade succeeds

  # B3: an image that adds only background steps still registers them.
  @unit @integration
  Scenario: A worker runs the upgrade for a background step the ledger has not registered
    Given every blocking step the image declares is done
    And the image declares a background step the ledger has no row for
    When the worker's gate asks
    Then the worker is behind, naming the unregistered step
    And it runs the upgrade once, which registers the step, then takes jobs

  @unit
  Scenario: An api serves while a background step is unregistered
    Given every blocking step the image declares is done
    And the image declares a background step the ledger has no row for
    When the api's gate asks
    Then the api is admitted

  # B5: a run that failed after its steps settled (a reconciler) is not "up to date".
  @unit @integration
  Scenario: A failed last run with every step settled reads as needs attention
    Given every step in the ledger is done
    And the newest upgrade run ended failed
    When the upgrade status is read
    Then the installation needs attention, with the reason "failed-run"

  # B2: decision pending.
  @unimplemented
  Scenario: A missing table on a ledger that says current is not reported as upgrading
    Given every blocking step the image declares is done
    And the Postgres schema lacks a table the image reads
    When a request reads that table
    Then the api does not answer "upgrade_in_progress" forever
    And the operator is told the schema and the ledger disagree

  # B4: decision pending.
  @unimplemented
  Scenario: A background step that never returns does not starve the steps after it
    Given a background step whose run neither finishes nor fails
    And a pending background step declared after it
    When the worker sweeps its background steps
    Then the later step still runs
    And the stuck step is reported once it passes its deadline

  # Follow-up to the planner fixes (stuck-states A): the Ops preview plans as the runner does.
  @integration
  Scenario: The preview plans a cut first install as fresh, as the runner does
    Given a seeded ledger whose only upgrade run planned a fresh install and failed
    And the ledger records schema below the LTS floor
    When the Upgrades page previews the upgrade
    Then the plan is a fresh install, not a refusal below the floor

  @integration
  Scenario: The preview reads the tools' records until a seed run has succeeded
    Given a ledger whose only seed run was cut before it finished
    And Prisma's history records every migration of the image's release
    When the Upgrades page previews the upgrade
    Then the installed release is read from Prisma's history
