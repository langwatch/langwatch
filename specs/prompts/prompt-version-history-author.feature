Feature: Prompt version history author clarity
  As a LangWatch user reviewing a prompt's version history
  I want each version to clearly show who authored it
  So that I can tell my teammates' changes apart from automated ones

  # Bound to src/prompts/__tests__/VersionHistoryListPopover.test.tsx
  # ("when displaying the author of a version"). Previously every version
  # rendered only a bare avatar with no name and no hover, so versions created
  # via the SDK/API (no author on record) and users with no display name both
  # showed as an anonymous silhouette.

  Background:
    Given I am logged into project "my-project"
    And I open the version history for a prompt

  @integration
  Scenario: Author with a display name is shown by name
    Given a version was authored by a user named "Ada Lovelace"
    Then that version's author row shows "Ada Lovelace"
    And hovering the row reveals a tooltip with the author's name and email

  @integration
  Scenario: Author without a display name falls back to their email
    Given a version was authored by a user who has no display name
    Then that version's author row shows the author's email
    And hovering the row reveals a tooltip with the author's email

  @integration
  Scenario: Version created outside the app shows Unknown author
    Given a version has no author on record
    Then that version's author row shows "Unknown author"
    And hovering the row explains that no author was recorded

  @integration
  Scenario: A signed-in author's profile photo is used as the avatar
    Given a version was authored by a user with a profile photo
    Then that version's avatar shows the photo instead of initials
