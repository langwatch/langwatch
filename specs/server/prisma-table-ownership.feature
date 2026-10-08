@adr-134
Feature: Private Prisma table ownership
  One feature owns a table and peers use its API.
  Repository declarations are checked before constructing feature applications.

  @unit
  Scenario Outline: Conflicting owners fail before factories run
    Given User and Annotation both declare the User table
    When the process boots for the <role> role
    Then boot fails naming both owners and the physical table
    And neither feature factory runs
    Examples:
      | role   |
      | api    |
      | worker |
      | task   |

  @unit
  Scenario: Multiple repositories implement one coherent owner
    Given two User repositories declare the User table
    When the ownership declarations are checked
    Then both repositories belong to the single User owner

  @unit
  Scenario: Mapped table names identify the same storage
    Given two features declare models mapped to the same physical table
    When the catalogue ownership lint runs
    Then it reports conflicting owners even if they never share a process

  @unit
  Scenario: Mutation cannot rewrite a declared claim
    Given a feature declaration snapshots its repository claims
    When external code mutates the original declaration data
    Then the feature retains its original frozen table claims

  @unit
  Scenario Outline: Invalid claims fail locally
    Given a repository declares <claim>
    When the claim is validated
    Then it is rejected with a repair instruction
    Examples:
      | claim                    |
      | an empty model list      |
      | an unknown model         |
      | a JavaScript prototype key |
      | a computed model list    |
      | a forwarded claim factory |

  @unit
  Scenario: An App cannot own a second copy of the table list
    Given an App calls prismaTables directly
    When the architecture lint runs
    Then it directs the claim to the private Prisma repository

  @unit
  Scenario Outline: A scoped repository cannot escape its owner
    Given a repository receives a capability for its declared tables
    When it attempts <access> to a foreign table
    Then access is rejected before a database query is issued
    Examples:
      | access                          |
      | a direct delegate               |
      | a nested relation selection     |
      | a relation filter               |
      | a nested write                  |
      | unrestricted raw SQL            |
      | a transaction client escape     |
      | a client extension escape       |

  @unit
  Scenario: A migration exception is narrower than ownership
    Given one repository has an approved exception for a specific foreign relation read
    When it attempts a write or a different foreign relation
    Then the operation is rejected
    And the foreign table retains its single original owner

  # Audit writes ride the producer's outbox after commit (Alex, Q72): modules/audit-log/specs/audit-log.feature.

  # Shared reads over copies (R40): an owner shares a model for reading; writes stay its own.
  @unit @architecture
  Scenario: A module reading a Prisma table its owner shares with it passes
    Given project claims Project and shares it for reading with entitlement
    When entitlement claims Project and reads it through a delegate and raw SQL
    Then no finding names entitlement or a second owner of Project

  @unit @architecture
  Scenario: A module the owner did not name still may not claim a shared Prisma table
    Given project shares Project for reading with entitlement only
    When experiment claims Project
    Then the policy reports Project as claimed by experiment and project

  @unit @architecture
  Scenario: A named reader writing a shared Prisma table is reported
    Given project shares Project for reading with entitlement
    When entitlement updates Project through a delegate or raw SQL
    Then the policy reports each write as reading-only access misused

  @unit @architecture
  Scenario: A shared Prisma table declared by a module that does not own it is reported
    Given the policy declares Project shared by organization
    And project is the module that claims Project
    When the policy runs
    Then the policy reports the declaration as naming the wrong owner

  @unit @architecture
  Scenario: A shared Prisma reader that no longer reads the table is reported
    Given project shares Project for reading with entitlement
    And entitlement no longer reads Project
    When the policy runs
    Then the policy asks for entitlement to be deleted from the declaration

  @unit @architecture
  Scenario: Every shared Prisma table carries a reason
    When the declared Prisma shares are read
    Then each one has a non-empty reason
