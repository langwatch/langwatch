Feature: The Langy composer says what happens to the chats
  LangWatch Cloud uses Langy chats to improve Langy, and the composer says so
  where people type. A self-hosted install sends none of its Langy chats to
  LangWatch (docs/self-hosting/data-and-telemetry.mdx), so the composer there
  makes no such claim.

  @integration
  Scenario: The Langy composer on a self-hosted install does not say chats go to LangWatch
    Given a self-hosted install
    When someone opens the Langy composer
    Then the composer carries no note that LangWatch uses the chats to improve Langy

  @integration
  Scenario: The Langy composer on LangWatch Cloud says chats are used to improve Langy
    Given LangWatch Cloud
    When someone opens the Langy composer
    Then the composer notes that LangWatch uses the chats to improve Langy
