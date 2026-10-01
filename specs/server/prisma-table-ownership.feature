@adr-134
Feature: Private Prisma table ownership
  One feature owns a table and peers use its API.
  Repository declarations are checked before constructing feature applications.

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

  Scenario: Multiple repositories implement one coherent owner
    Given two User repositories declare the User table
    When the ownership declarations are checked
    Then both repositories belong to the single User owner

  Scenario: Mapped table names identify the same storage
    Given two features declare models mapped to the same physical table
    When the catalogue ownership lint runs
    Then it reports conflicting owners even if they never share a process

  Scenario: Mutation cannot rewrite a declared claim
    Given a feature declaration snapshots its repository claims
    When external code mutates the original declaration data
    Then the feature retains its original frozen table claims

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

  Scenario: An App cannot own a second copy of the table list
    Given an App calls prismaTables directly
    When the architecture lint runs
    Then it directs the claim to the private Prisma repository

  @pending-isolation
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

  @pending-isolation
  Scenario: A migration exception is narrower than ownership
    Given one repository has an approved exception for a specific foreign relation read
    When it attempts a write or a different foreign relation
    Then the operation is rejected
    And the foreign table retains its single original owner

  @pending-isolation
  Scenario: Cross-feature audit writes preserve transactional behavior
    Given an existing operation writes its domain mutation and audit record atomically
    When that operation migrates to the AuditLog feature boundary
    Then a failed audit write preserves the existing rollback behavior
    And no unrelated database capability is exposed to the caller
