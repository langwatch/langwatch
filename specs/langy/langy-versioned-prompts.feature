@unimplemented
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

  Scenario: A turn runs from the in-repo copy when no registry row exists
    Given no Langy prompt row exists in the registry
    When a Langy turn starts
    Then Langy uses the in-repo prompt text verbatim
    And the turn is not blocked

  Scenario: A registry read failure falls back to the in-repo copy
    Given a Langy prompt row exists in the registry
    But the registry read fails
    When a Langy turn starts
    Then Langy uses the in-repo prompt text verbatim
    And the failure is logged, not surfaced to the user
    And the turn is not blocked

  Scenario: An empty or blank registry prompt is treated as a miss
    Given a Langy prompt row exists but its prompt text is blank
    When a Langy turn starts
    Then Langy uses the in-repo prompt text verbatim

  # ---------------------------------------------------------------------------
  # When a promoted registry version exists, it wins
  # ---------------------------------------------------------------------------

  Scenario: A production-tagged registry version is used when present
    Given the Langy agent-definition prompt has a version tagged production
    When a Langy turn starts
    Then Langy uses the production-tagged registry text
    And a draft version that is not tagged production is not used

  Scenario: Editing the prompt in the registry changes Langy without a redeploy
    Given the Langy prompt has a production version in the registry
    When a new version is created and promoted to production
    Then the next Langy turn uses the new text
    And no code change or redeploy was required

  # ---------------------------------------------------------------------------
  # Seeding the current prompts as version 1
  # ---------------------------------------------------------------------------

  Scenario: Seeding inserts the current prompts as version 1
    Given the internal LangWatch system project has no Langy prompt rows
    When the Langy prompt seed is run for that project
    Then the agent-definition doc is stored as version 1 of "langy-agent-definition"
    And the per-turn override is stored as version 1 of "langy-turn-override"
    And each version 1 is promoted to production

  Scenario: Re-seeding unchanged prompts is a no-op
    Given the Langy prompts are already seeded at their current text
    When the Langy prompt seed is run again
    Then no new versions are created

  Scenario: Re-seeding changed prompts adds a new version and re-promotes it
    Given the Langy prompts are seeded and the in-repo text has since changed
    When the Langy prompt seed is run again
    Then a new version is created for each changed prompt
    And production is re-pointed at the new version
