Feature: Process members refuse what a process did not give them

  A process builds its stores from its configuration. A member it was not given
  an address for, or one handed in as undefined, is a refusal naming the member,
  never a client built against nothing.

  @unit
  Scenario: A member handed in as undefined is a refusal, not an omission
    Given a process hands in a member as an own property whose value is undefined
    When the process stores are built
    Then they refuse, naming the member, rather than building the real client

  @unit
  Scenario: A store with no address refuses at boot
    Given a process that named no address for a store
    When a member or module that needs that store is read or booted
    Then it refuses, naming the member and the setting it is missing
    And the members built over that store refuse for the same reason
    And no live repository factory runs and no memory tier is chosen in its place

  @unit
  Scenario: Opened stores state the live tier
    Given a process builds its stores from config
    When boot reads the member source
    Then the source states the live tier, so boot never assumes one
