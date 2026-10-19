Feature: Counting a project's versioned prompts for the setup checklist

  The onboarding checklist asks the prompt module how many of a project's own
  prompts are live and hold at least one version, as main's checks did.

  @integration
  Scenario: Only live prompts holding a version count toward the prompt step
    Given a project with a deleted versioned prompt and a live prompt with no version
    Then the versioned prompt count is 0
    When the live prompt gains a version
    Then the versioned prompt count is 1
