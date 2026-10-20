Feature: First run asks whether to use bundled databases or your own
  As someone installing LangWatch on my own machine
  I want to choose between bundled databases and the ones I already run
  So that I neither download databases I have nor have to set any up

  # Postgres, Redis and ClickHouse. "Bundled" means the CLI downloads, runs and stops them inside
  # ~/.langwatch, as it does today. "My own" means a URL to a server the person already runs: the
  # CLI neither downloads nor starts it. The answer lives in ~/.langwatch/.env as the three
  # database URLs: one naming this machine on the bundled port is bundled, any other is brought.

  @unit
  Scenario: The first interactive run asks once, with bundled as the default
    Given a machine with no LangWatch install
    And an interactive terminal
    When they run "npx @langwatch/server"
    Then it asks how LangWatch should run its databases
    And "Bundled" is selected by default

  @unit
  Scenario: Choosing bundled runs all three inside ~/.langwatch
    Given they answer "Bundled"
    Then Postgres, Redis and ClickHouse are downloaded and started inside "~/.langwatch"
    And it asks nothing more about databases

  @unit
  Scenario: Choosing my own asks per database
    Given they answer "Use my own"
    Then it asks, for each of Postgres, Redis and ClickHouse, whether to use their own or the bundled one

  @unit
  Scenario: A database they bring is connected before it is saved
    Given they chose their own Postgres
    When they enter its URL
    Then the CLI connects to it before going on
    And a URL it cannot reach is refused with the reason, and asked for again

  @unit
  Scenario: A database they bring is neither downloaded nor started
    Given they chose their own Postgres and the bundled Redis and ClickHouse
    When LangWatch starts
    Then no Postgres is downloaded or started
    And the backend uses their Postgres URL
    And Redis and ClickHouse run bundled

  @unit
  Scenario: The answer is kept and not asked again
    Given an install that already answered the database question
    When they run "npx @langwatch/server" again
    Then it does not ask about databases
    And it uses the same databases as before

  @unit
  Scenario: Non-interactive runs use bundled without asking
    Given "--yes" is passed, or the run is in CI, or the terminal is not interactive
    When it runs for the first time
    Then it uses bundled databases without asking

  @unit
  Scenario: The choice can be changed later
    Given an install that uses bundled databases
    When they run "npx @langwatch/server --databases"
    Then it asks the database question again
    And the new answer replaces the old one in the .env
    And data in the bundled databases is left where it is

  @unit
  Scenario: A bundled database may be named by any loopback address
    Given the .env names the bundled Redis as "localhost", "127.0.0.1" or "::1" on its bundled port
    Then Redis counts as bundled
    And a URL naming another host, or another port, counts as their own

  @unit
  Scenario: Doctor checks the databases the install uses
    Given they chose their own Postgres
    When they run "npx @langwatch/server doctor"
    Then the upgrade status is read from their Postgres URL
    And the port table leaves out the bundled Postgres port
