Feature: Customer.io hears when a governance source is connected and when its first data arrives
  Governance records an ingestion source's creation and its first data as its own facts,
  lw.governance.ingestion_source_created and lw.governance.ingestion_source_went_live, each naming
  the organization, the source, its type and the person who created it. Nurturing reacts to them
  as a peer and never reads governance's tables (ADR-001). The organization's Company learns it
  has a source, then data, traits only ever set true. One current member gets the event: the
  person who created the source while they are a current member and not erased, else the
  organization's admin, so no one who left is re-attached to its Company. Each call is claimed on
  its own, and each event carries the fact's own message id.
  Pulled sources never record went-live, so has_governance_data is never set for them.

  @unit
  Scenario: A created source groups has_governance_source and tracks it to its creator
    Given a current member creates a governance ingestion source in their organization
    When governance's created fact is delivered
    Then Customer.io groups the person with the organization, with has_governance_source true
    And tracks governance_source_connected to them with the source's id, type and organization only
    And its message id is "<source>:connected"

  @unit
  Scenario: A source's first data groups has_governance_data and tracks it to its creator
    Given a governance source its creator connected, still a current member
    When governance's went-live fact is delivered
    Then Customer.io groups the creator with the organization, with has_governance_data true
    And tracks governance_source_live to them with the source's id, type and organization only
    And its message id is "<source>:live"

  @unit
  Scenario: A governance source fact delivered twice sends each call once
    Given governance's created or went-live fact for one source
    When it is delivered twice
    Then Customer.io receives its group call once and its event once

  @unit
  Scenario: A governance source fact naming no person goes to the organization's admin
    Given a source no person created
    And the organization's admin is a current member
    When governance's created or went-live fact is delivered
    Then Customer.io groups the admin with the organization and tracks the event to them

  @unit
  Scenario: A governance source fact whose creator is no longer a member goes to the admin
    Given the person who created the source has left the organization
    And the organization's admin is a current member
    When governance's created fact is delivered
    Then Customer.io groups the admin with the organization and tracks the event to them
    And no call names the person who left

  @unit
  Scenario: A governance source fact with no current member and no admin sends nothing
    Given the person who created the source has left the organization
    And the organization's admin is no current member
    When governance's created fact is delivered
    Then Customer.io receives no call

  @unit
  Scenario: A governance source fact naming an erased person goes to the admin instead
    Given the person who created the source was erased
    And the organization's admin is a current member
    When governance's created fact is delivered
    Then Customer.io groups the admin with the organization and tracks the event to them
    And no call names the erased person

  @unit
  Scenario: A refused governance source event is retried without resending the group call
    Given Customer.io refuses the governance_source_connected track once
    When the created fact is delivered, then retried
    Then the first delivery fails so its job is retried
    And the retry sends the track once, and the group call is sent once in all
