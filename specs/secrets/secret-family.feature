Feature: A secret family answers every name under one prefix
  As the stores reading main's per-organization ClickHouse URLs
  I want one declared handle for a family of secret names sharing a prefix
  So that credentials a deployment names by convention resolve through the chain, never the env

  # ADR-132 amendment (Alex, 2026-09-29) and ARCHITECTURE.md §6: a family handle answers
  # name -> value for one prefix; env and .env scan by prefix; 1Password answers none; the
  # resolver scopes by prefix; preflight treats a family as optional; config may not claim a
  # name under a declared prefix.

  @unit
  Scenario: A family answers every set name under its prefix from the environment and the file
    Given the environment sets two names under the prefix and one name outside it
    And the .env file sets a third name under the prefix and repeats one the environment sets
    When an owner that declared the family resolves it
    Then it receives the three names under the prefix, the environment's value winning the repeat

  @unit
  Scenario: A family nobody sets resolves empty and never fails the preflight
    Given no name under the prefix is set anywhere
    When the boot preflights and the owner resolves the family
    Then the preflight passes and the family resolves to no names

  @unit
  Scenario: An owner that did not declare the family cannot resolve it
    Given an owner that declared a single secret spelled like the prefix
    When it resolves the family
    Then it is refused with secret_undeclared

  @unit
  Scenario: A config leaf under a declared family prefix refuses naming both owners
    Given the stores declare the family CLICKHOUSE_URL__
    And another owner declares a config leaf read from CLICKHOUSE_URL__acme__org_1
    When the process config is parsed
    Then it refuses with config_claims_secret, the refusal naming that owner and the stores
