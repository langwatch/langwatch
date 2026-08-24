Feature: Langy local dogfood doctor

  Running Langy locally needs five things wired at once: the Langy env block
  in .env (agent URL, shared secret, the no-sandbox dev flag,
  writable session/workspace roots), the release flag force-enabled, the
  opencode binary on PATH, three live services (app, AI gateway, langyagent),
  and a model provider whose key actually works. Each missing piece fails a
  turn with a different distant symptom, so discovering them one by one costs
  an hour of log spelunking. dev/scripts/dogfood/langy-local.sh checks all of it
  in one pass and prints the exact fix for whatever is missing.

  Background:
    Given a developer in the langwatch monorepo

  @unit
  Scenario: A fully wired setup passes every check
    Given the Langy env block is present in .env
    And the release flag is force-enabled
    And opencode is on PATH
    And the app, gateway, and langyagent are listening
    When the developer runs the doctor
    Then every check reports ok
    And it exits zero with the URL to open and dogfood

  @unit
  Scenario: A missing env entry prints the exact lines to add
    Given .env has no LANGY_INTERNAL_SECRET
    When the developer runs the doctor
    Then the check fails naming the missing keys
    And it prints a ready-to-paste env block, secret generation included
    And it exits non-zero

  @unit
  Scenario: A dead service prints the command that starts it
    Given the langyagent port is not listening
    When the developer runs the doctor
    Then the check fails naming the service
    And it prints the exact start command for it

  @unit
  Scenario: A provider key that the provider rejects is caught before a turn wastes time on it
    Given an OPENAI_API_KEY is present in .env
    But the provider answers it with an auth failure
    When the developer runs the doctor
    Then the key check reports the rejection
    And the doctor still exits by the state of the other checks so a claude-only setup is not blocked
