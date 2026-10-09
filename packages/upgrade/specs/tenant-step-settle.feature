# How a tenant step's ledger row follows its tenants (Alex, 2026-10-09, S6-SETTLE). One framework
# service reads the tenant state table after each pass and level-triggers the row; ops never
# names a ledger status. A tenant step never blocks: the worker drives it, tenant by tenant.

Feature: A tenant step's ledger row follows its tenants' state
  As an operator of a LangWatch installation
  I want a tenant step recorded done only while none of its tenants is held or parked
  So that the ledger never says a tenant migration finished while a tenant still waits on it

  @unit
  Scenario: A tenant step's ledger row is done once no tenant is held or parked
    Given a tenant step whose tenants are all migrated or finalized
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

  @unit
  Scenario: A blocking tenant step is refused by name
    When a tenant step is defined with mode blocking
    Then the definition refuses, naming the module and the step
