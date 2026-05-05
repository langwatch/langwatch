@unit
Feature: Usage limit 429 message includes upgrade instructions
  As a developer integrating with LangWatch
  I want clear upgrade instructions when I hit the usage limit
  So that I know how to increase my quota

  # Free tier counts "events", paid TIERED counts "traces".
  # The message must reflect the actual usage unit being counted.
  # All 4 scenarios bound to langwatch/src/server/license-enforcement/__tests__/limit-message.unit.test.ts.

  # All 4 scenarios are bound to limit-message.unit.test.ts via @scenario JSDoc.
  # The buildLimitMessage helper was extracted from usage.service.ts into
  # langwatch/src/server/app-layer/usage/limit-message.ts to make it directly
  # testable without spinning up the full UsageService.

  Scenario: Free-tier org on SaaS told to upgrade with correct unit
    Given a free-tier organization that has exceeded 50000 events
    And the platform is running in SaaS mode
    When the usage limit message is built
    Then the prefix reads "Free plan"
    And the action contains "upgrade your plan at https://app.langwatch.ai/settings/subscription"

  Scenario: Free-tier org on self-hosted told to buy a license
    Given a free-tier organization that has exceeded 50000 events
    And the platform is running in self-hosted mode
    And the BASE_HOST is "https://my-langwatch.example.com"
    When the usage limit message is built
    Then the prefix reads "Free plan"
    And the action contains "get a license at https://my-langwatch.example.com/settings/license"

  Scenario: Paid TIERED org on SaaS told to upgrade with traces unit
    Given a paid TIERED organization that has exceeded 10000 traces
    And the platform is running in SaaS mode
    When the usage limit message is built
    Then the prefix reads "Plan"
    And the action contains "upgrade your plan at https://app.langwatch.ai/settings/subscription"

  Scenario: Paid TIERED org on self-hosted told to buy a license
    Given a paid TIERED organization that has exceeded 10000 traces
    And the platform is running in self-hosted mode
    And the BASE_HOST is "https://my-langwatch.example.com"
    When the usage limit message is built
    Then the prefix reads "License"
    And the action contains "upgrade your license at https://my-langwatch.example.com/settings/license"
