@unit
Feature: Usage limit 429 message includes upgrade instructions
  As a developer integrating with LangWatch
  I want clear upgrade instructions when I hit the usage limit
  So that I know how to increase my quota

  # Free tier counts "events", paid TIERED counts "traces".
  # The message must reflect the actual usage unit being counted.

  Scenario: Free-tier org on SaaS told to upgrade with correct unit
    Given a free-tier organization that has exceeded 50000 events
    And the platform is running in SaaS mode
    When the usage limit check returns exceeded
    Then the message contains "Free limit of 50000 events reached"
    And the message contains "upgrade your plan at https://app.langwatch.ai/settings/subscription"

  Scenario: Free-tier org on self-hosted told to buy a license
    Given a free-tier organization that has exceeded 50000 events
    And the platform is running in self-hosted mode
    And the BASE_HOST is "https://my-langwatch.example.com"
    When the usage limit check returns exceeded
    Then the message contains "Free limit of 50000 events reached"
    And the message contains "buy a license at https://my-langwatch.example.com/settings/license"

  Scenario: Paid TIERED org on SaaS told to upgrade with traces unit
    Given a paid TIERED organization that has exceeded 10000 traces
    And the platform is running in SaaS mode
    When the usage limit check returns exceeded
    Then the message contains "Monthly limit of 10000 traces reached"
    And the message contains "upgrade your plan at https://app.langwatch.ai/settings/subscription"

  Scenario: Paid TIERED org on self-hosted told to buy a license
    Given a paid TIERED organization that has exceeded 10000 traces
    And the platform is running in self-hosted mode
    And the BASE_HOST is "https://my-langwatch.example.com"
    When the usage limit check returns exceeded
    Then the message contains "Monthly limit of 10000 traces reached"
    And the message contains "buy a license at https://my-langwatch.example.com/settings/license"
