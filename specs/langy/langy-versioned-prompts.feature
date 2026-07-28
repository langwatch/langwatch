# ADR-050 is WIRED as of #5881: the turn service resolves its system override
# through the registry when LANGY_PROMPT_PROJECT_ID names the project holding
# the rows, and falls back to the in-repo text otherwise. The feature-level
# @unimplemented tag this file carried was written when the loader had no
# caller; scenarios still lacking an executable binding are tagged individually.
Feature: Langy's prompts are stored and versioned in the prompt registry
  As the owner of the Langy in-product assistant
  I want Langy's agent-definition doc and per-turn override stored as versioned
  prompts in LangWatch's own registry
  So that we can review, diff, promote, and edit Langy's behaviour without a
  redeploy — while Langy can never fail to run because a prompt row is missing

  # Design: ADR-050. The registry read is a direct service call (Prisma), never
  # the SDK/CLI, so it needs no LANGWATCH_API_KEY and does not trip the platform
  # self-reference guard.

  # ---------------------------------------------------------------------------
  # The in-repo copy is always a safe fallback
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A turn runs from the in-repo copy when no registry row exists
    Given no Langy prompt row exists in the registry
    When a Langy turn starts
    Then Langy uses the in-repo prompt text verbatim
    And the turn is not blocked

  @unit
  Scenario: A registry read failure falls back to the in-repo copy
    Given a Langy prompt row exists in the registry
    But the registry read fails
    When a Langy turn starts
    Then Langy uses the in-repo prompt text verbatim
    And the failure is logged, not surfaced to the user
    And the turn is not blocked

  # A blip is not a demotion. The system block is the provider's cache prefix
  # and is meant to be byte-identical across a conversation's turns, so letting
  # a failed read swap it mid-conversation both changes the instructions the
  # model is working under and re-writes the whole prefix at the write premium.
  @unit
  Scenario: A read failure after a successful read keeps the text already in use
    Given a Langy turn has already run from a promoted registry version
    When a later registry read fails
    And the same conversation takes its next turn
    Then Langy reuses the registry text it last read successfully
    And it does not swap back to the in-repo copy mid-conversation

  # Reusing the last good text must not outlive the row it came from. Removing a
  # promoted version is a deliberate act, and the removal has to stick: if a
  # later blip could bring the old wording back, an operator could not rely on
  # having withdrawn it.
  @unit
  Scenario: Withdrawing a promoted version is not undone by a later read failure
    Given a Langy turn has already run from a promoted registry version
    And that version is then withdrawn
    When a later registry read fails
    Then Langy uses the in-repo copy
    And the withdrawn wording is not served again

  @unit
  Scenario: An empty or blank registry prompt is treated as a miss
    Given a Langy prompt row exists but its prompt text is blank
    When a Langy turn starts
    Then Langy uses the in-repo prompt text verbatim

  # ---------------------------------------------------------------------------
  # When a promoted registry version exists, it wins
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A production-tagged registry version is used when present
    Given the Langy turn-override prompt has a version tagged production
    When a Langy turn starts
    Then Langy uses the production-tagged registry text
    And a draft version that is not tagged production is not used

  @unimplemented
  Scenario: Editing the prompt in the registry changes Langy without a redeploy
    Given the Langy prompt has a production version in the registry
    When a new version is created and promoted to production
    Then the next Langy turn uses the new text
    And no code change or redeploy was required

  # ---------------------------------------------------------------------------
  # Seeding the current prompts as version 1
  # ---------------------------------------------------------------------------

  @unimplemented
  Scenario: Seeding inserts the current prompts as version 1
    Given the internal LangWatch system project has no Langy prompt rows
    When the Langy prompt seed is run for that project
    Then the agent-definition doc is stored as version 1 of "langy-agent-definition"
    And the per-turn override is stored as version 1 of "langy-turn-override"
    And each version 1 is promoted to production

  @unimplemented
  Scenario: Re-seeding unchanged prompts is a no-op
    Given the Langy prompts are already seeded at their current text
    When the Langy prompt seed is run again
    Then no new versions are created

  @unimplemented
  Scenario: Re-seeding changed prompts adds a new version and re-promotes it
    Given the Langy prompts are seeded and the in-repo text has since changed
    When the Langy prompt seed is run again
    Then a new version is created for each changed prompt
    And production is re-pointed at the new version
