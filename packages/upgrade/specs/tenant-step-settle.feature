# How a tenant step's ledger row follows its tenants (Alex, 2026-10-09, S6-SETTLE). One framework
# service reads the tenant state table after each pass and level-triggers the row; ops never
# names a ledger status. A tenant step never blocks: the worker drives it, tenant by tenant.

Feature: A tenant step's ledger row follows its tenants' state
  As an operator of a LangWatch installation
  I want a tenant step recorded done only while none of its tenants is held or parked
  So that the ledger never says a tenant migration finished while a tenant still waits on it

  @unit
  Scenario: A tenant step's ledger row is done once no tenant is held or parked
    Given a tenant step whose eligible tenants have all finalized or rolled back
    When the step is settled after a pass
    Then its ledger row is done

  @unit
  Scenario: A settled tenant step reopens when a tenant is held or parked again
    Given a tenant step whose ledger row is done
    When a later pass holds one tenant, or parks one
    And the step is settled after that pass
    Then its ledger row is pending again

  @integration
  Scenario: Settling writes only a tenant step's pending or done row
    Given the ledger holds a pending tenant step and a failed one
    When both are settled with no held or parked tenant
    Then the pending one is done and the failed one is still failed
    And a held tenant reopens the done one to pending

  # A hold waiting on a person, like a steady step's `migrated`, is settled (2026-10-21).
  @unit
  Scenario: A tenant waiting on a person does not keep a tenant step pending
    Given a tenant step whose eligible tenants have finalized or wait on a person
    When the step is settled after a pass
    Then its ledger row is done
    But a tenant held because its proof disagreed reopens it to pending

  @integration
  Scenario: Settling over Postgres treats a tenant waiting on a person as settled
    Given the ledger holds a tenant step with one finalized tenant and one waiting on a person
    When it is settled
    Then it is done
    And a tenant held for its proof reopens it to pending

  @unit
  Scenario: A blocking tenant step is refused by name
    When a tenant step is defined with mode blocking
    Then the definition refuses, naming the module and the step

  # Ruled small (Alex, 2026-10-12, SWB-F5 and the queue-pacing ruling): the declaration keeps both.
  @unit
  Scenario: A tenant step keeps its declared steadiness and queue bound
    Given a tenant step declaring migratedIsSteady and pauseWhileQueuedAbove
    When the declaration is parsed
    Then both reach the pass unchanged

  # Step 4 of the legacy conversion (Alex, 2026-10-12): Ops' page reads declared steps' state here.
  @unit
  Scenario: Ops reads a tenant step's counts and attention rows from the framework's table
    Given tenant steps with finalized, parked and migrated tenants
    When Ops reads one step's status counts and the tenants needing attention
    Then each status is counted and only that step's parked or held tenants are listed

  @unit
  Scenario: Ops lists a step's held tenants without those waiting on a person, and counts those apart
    Given a tenant step with a tenant held for its proof, one parked and two waiting on a person
    When Ops reads the tenants needing attention and the count waiting on a person
    Then only the held and parked tenants are listed
    And two are counted waiting on a person
    And asking for tenants held for queued work finds none
