Feature: API keys credentials table
  As someone responsible for the credentials an organization has issued
  I want the API keys table to say what each key is, how far it reaches, and who owns it
  So that I can find the key I am looking for and revoke the ones that should not exist

  # The read surface of Settings > API keys.
  #
  # Two filters sit in one toolbar and compose:
  #   - the scope-KIND chips in this file pick a LEVEL of the organization tree
  #     (organization / team / project) and carry a live count;
  #   - the scope picker specified in specs/api-keys/scope-filter.feature picks
  #     ONE organization, team, or project and applies an inclusive cascade.
  # The chips count the rows that survive the picker, so the two never disagree.
  #
  # Columns come from the ApiKey model as it actually is:
  #   name, lookupId prefix, permissionMode (all / readonly / restricted),
  #   owning user (null for a service key), createdAt, lastUsedAt, expiresAt,
  #   revokedAt, roleBindings (ORGANIZATION / TEAM / PROJECT).
  # There is no per-key "person" scope: a personal key's reach is the role
  # bindings copied from its owner, so the owner is a column, not a scope.
  #
  # Sibling specs: specs/api-keys/unified-api-keys.feature (list contract),
  # specs/api-keys/scope-filter.feature (the scope picker cascade).

  Background:
    Given I am signed in as a user in an organization
    And I am on Settings > API keys

  # ==========================================================================
  # Scope-kind chips
  # ==========================================================================

  @integration
  Scenario: The chip row counts the keys at each level of the organization
    Given there are two keys bound only at the organization
    And there is one key bound only to a team
    And there are three keys bound only to a project
    When the page loads
    Then I see a chip reading "All keys" with a count of six
    And I see a chip reading "Organization" with a count of two
    And I see a chip reading "Team" with a count of one
    And I see a chip reading "Project" with a count of three
    And the "All keys" chip is the emphasized one

  @integration
  Scenario: A level with no keys gets no chip
    Given every key is bound only to a project
    When the page loads
    Then I see a chip reading "Project"
    And I do not see a chip reading "Organization"
    And I do not see a chip reading "Team"

  @integration
  Scenario: Picking a level shows only the keys bound at that level
    Given there are keys bound at the organization, at a team, and at a project
    When I pick the "Team" chip
    Then the table lists only the keys with a team-scoped binding
    And the "Team" chip is the emphasized one
    And the "All keys" chip is no longer emphasized

  @integration
  Scenario: Picking the same chip twice returns to all keys
    Given I have picked the "Project" chip
    When I pick the "Project" chip again
    Then the table lists every key again
    And the "All keys" chip is the emphasized one

  @integration
  Scenario: A key bound at two levels is counted and shown under both
    Given one key is bound at the organization and also to a project
    When I pick the "Organization" chip
    Then that key is listed
    And when I pick the "Project" chip that key is listed as well
    And a note explains that a key bound at more than one level is counted under each

  @unit
  Scenario: Counts describe the rows on screen, not the whole organization
    Given the scope picker has narrowed the table to one team's branch
    When the chip counts are computed
    Then each count counts only the keys that survived the scope picker
    And the "All keys" count equals the number of rows the table would render

  # ==========================================================================
  # How many keys am I looking at
  # ==========================================================================

  @integration
  Scenario: The header says how many keys the filter is showing
    Given the organization has six keys
    When I pick a chip that matches two of them
    Then the header reads that two of six keys are shown

  @integration
  Scenario: Narrowing to nothing explains why the table is empty
    Given the organization has keys, but none at the level I picked
    When the table has no rows to show
    Then the table area explains that no keys match the current filter
    And it does not read as though the organization has no keys at all

  # ==========================================================================
  # The row: what a key says about itself
  # ==========================================================================

  @integration
  Scenario: A key row names the key and shows only the start of its secret
    Given a key named "CI Pipeline"
    When the row renders
    Then the name "CI Pipeline" is shown
    And a shortened key identifier beginning "sk-lw-" is shown beneath it
    And the shortened identifier is visibly truncated

  @regression
  Scenario: The full secret is never shown after the key is created
    Given a key was created in an earlier session
    When the table renders that key
    Then no element contains the key's full secret
    And the only key material shown is the shortened identifier

  @integration
  Scenario: Copying the shortened identifier says that is what was copied
    Given a key row is on screen
    When I use the copy control next to the shortened identifier
    Then the control is labelled as copying the key identifier, not the key
    And the confirmation says the key identifier was copied

  @integration
  Scenario: The access column tells the three permission modes apart
    Given one key grants everything its bindings allow
    And one key grants read access only
    And one key grants an explicit list of permissions
    Then their access column reads "Full access", "Read only", and "Restricted" in that order
    And no two of those three read the same

  @integration
  Scenario: A service key names itself in the owner column instead of rendering empty
    Given a key that belongs to no person
    When the row renders
    Then the owner column reads "Service key"
    And it is not blank

  @integration
  Scenario: A personal key shows its owner
    Given a key owned by a person named "Riley Chen"
    When the row renders
    Then the owner column shows "Riley Chen" with their avatar

  @integration
  Scenario: A key that has never been used says so
    Given a key that has never authenticated a request
    When the row renders
    Then the last used column reads "Never used"
    And it is not blank

  @integration
  Scenario: A key that reaches many places does not spill a wall of chips
    Given a key bound to five different projects
    When the row renders
    Then at most two scope chips are shown
    And the remainder is summarized as a count of the scopes not shown

  @integration
  Scenario: An expired key is marked, an active one is not
    Given one key has passed its expiry date and one has not
    When the rows render
    Then the expired key carries an "Expired" marker next to its name
    And the active key carries no status marker at all

  # ==========================================================================
  # Acting on a key
  # ==========================================================================

  @integration
  Scenario: Row actions live behind one overflow menu
    Given I can edit and revoke a key
    When the row renders
    Then the row's actions are behind a single overflow menu
    And the menu offers "Edit" and "Revoke"
    And "Revoke" is tinted as destructive

  @integration
  Scenario: Revoking asks before it acts
    Given a key I am allowed to revoke
    When I choose "Revoke" from the row's overflow menu
    Then I am asked to confirm before anything is revoked
    And the key is still listed while the question is open

  @integration
  Scenario: Confirming a revoke removes the key from the list
    Given the revoke confirmation is open
    When I confirm
    Then the key is revoked
    And the list is refreshed so the key no longer appears

  @integration
  Scenario: Dismissing the revoke confirmation changes nothing
    Given the revoke confirmation is open
    When I dismiss it
    Then nothing is revoked
    And the key is still listed

  @integration
  Scenario: A key I may not act on offers no menu
    Given a key owned by someone else and I am not an administrator
    When the row renders
    Then the row shows no overflow menu

  # ==========================================================================
  # When the list cannot be loaded
  # ==========================================================================

  @integration
  Scenario: A failed load explains itself instead of showing an empty table
    Given the API keys cannot be loaded
    When the page renders
    Then an error notice explains what went wrong
    And the empty-table message claiming there are no keys is not shown

  @integration
  Scenario: While the list is loading the table does not claim the organization has no keys
    Given the API keys are still loading
    When the page renders
    Then the table shows that it is loading
    And the "no API keys" empty state is not shown
