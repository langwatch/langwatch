Feature: Restoring a prompt version refuses by name
  As an integrator restoring a prompt to an earlier version
  I want the two refusals persistence owns to arrive named
  So that a client can tell "no such version" from "that version already exists"

  # Both were plain Errors, so both reached the process boundary as an
  # unattributed 500. Measured against main on 2026-09-21:
  # POST /api/prompts/{id}/versions/{versionId}/restore answered 409 there and
  # 500 here, and the same pass found PUT /api/prompts/{id}/tags/{tag}
  # answering 422 there and 500 here — a third, repository-local
  # TagValidationError the transport's own catch did not match.

  @unit
  Scenario: Restoring a version that does not exist is refused by name
    Given a restore naming a version this project does not have
    When the restore runs
    Then it is refused as prompt_not_found at 404

  @unit
  Scenario: A restore that collides on the version number answers a conflict
    Given a restore whose new version number the prompt already has
    When persistence refuses the write
    Then it is refused as prompt_version_conflict at 409
    And the database's own constraint error does not reach the caller

  @unit
  Scenario: An invalid tag assignment is refused by name
    Given a tag that is not a custom tag defined for this organization
    When it is assigned to a prompt version
    Then it is refused as prompt_tag_invalid
