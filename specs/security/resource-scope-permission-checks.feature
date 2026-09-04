Feature: Permissions are resolved at the scope of the resource acted on
  As a customer whose teams and projects hold different people
  I want every permission check bound to the resource the request names
  So that a grant on one scope never reaches a sibling scope, and a grant on
  the right scope is not refused because the check asked at the wrong tier

  # Background
  #
  # The 2026-09-04 feature-surface security pass found one defect repeated
  # across six transports: the permission is checked at one scope while the
  # data is read or written at another. Either direction is a bug — checking
  # too high lets one broad grant reach every sibling, and checking on the
  # caller's own scope while the handler widens to the organization lets a
  # single project's key manage the whole tenant.
  #
  # Findings H4, H6, H7, H8, H9 and H12 of
  # dev/docs/plans/security-pass-2026-09-04-features.md.

  # ────────────────────────────────────────────────────────────────────────────
  # H4 — organization REST apps addressing one project or one team
  # ────────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: A project route resolves its permission at the project it names
    Given an organization credential that can manage one project of an organization
    When it asks a project route about a different project of the same organization
    Then the request is refused and the project is never read

  @unit
  Scenario: Rotating a project's ingestion key is authorized on that project
    Given an organization credential that can manage one project of an organization
    When it asks to regenerate a sibling project's ingestion key
    Then the request is refused and no key is rotated

  @unit
  Scenario: A team route resolves its permission at the team it names
    Given an organization credential that can manage one team of an organization
    When it asks a team route about a different team of the same organization
    Then the request is refused before the team service is asked

  # ────────────────────────────────────────────────────────────────────────────
  # H6 — governance ingestion templates read by id
  # ────────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: Reading one ingestion template demands the same permission as reading them all
    Given a credential that may view AI tools but not manage them
    When it reads a single ingestion template by its id
    Then the request is refused and the canonical rules are not disclosed

  @unit
  Scenario: A key with no user behind it cannot read an ingestion template by id
    Given a legacy project key that carries no user
    When it reads a single ingestion template by its id
    Then the request is refused, as it already is for the bulk listing

  # ────────────────────────────────────────────────────────────────────────────
  # H7 — prompt tag assignment
  # ────────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: Assigning a tag writes into the project the caller was authorized on
    Given a credential that may manage prompts in one project
    And an organization-scoped prompt owned by a sibling project
    When it assigns a tag to that prompt
    Then the assignment is written for the authorized project, never the owner's

  # ────────────────────────────────────────────────────────────────────────────
  # H8 — organization-wide prompt tag rename and delete
  # ────────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: Renaming a prompt tag demands the permission across the organization
    Given a credential that may manage prompts in one project only
    When it renames a prompt tag that every project in the organization resolves
    Then the request is refused and no tag is renamed

  @unit
  Scenario: Deleting a prompt tag demands the permission across the organization
    Given a credential that may manage prompts in one project only
    When it deletes a prompt tag whose assignments span the organization
    Then the request is refused and no assignment is removed

  # ────────────────────────────────────────────────────────────────────────────
  # H9 — workflow optimization chat
  # ────────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: Starting an optimization chat demands the permission to run a workflow
    Given a member who may view workflows but not run them
    When they start an optimization chat for a workflow
    Then the request is refused before any workflow is executed

  # ────────────────────────────────────────────────────────────────────────────
  # H12 — gateway budgets and cache rules
  # ────────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: An organization-wide gateway write is authorized at the organization
    Given a project-scoped key that may delete gateway budgets in its own project
    When it archives a budget belonging to a sibling project of the organization
    Then the request is refused and the budget is left in place

  @unit
  Scenario: An organization-wide cache-rule write is authorized at the organization
    Given a project-scoped key that may manage gateway cache rules in its own project
    When it changes a cache rule the whole organization shares
    Then the request is refused and the rule is unchanged
