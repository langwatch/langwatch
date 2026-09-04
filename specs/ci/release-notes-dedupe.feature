Feature: One release-note entry per commit
  As someone reading a LangWatch changelog or an SDK changelog
  I want every released change listed once
  So that the notes name real work instead of parsing artifacts

  # Squash merges here carry COMMIT_MESSAGES, so a pull request whose commit
  # body opens with its own conventional-commit line parses as two entries
  # against one sha: the subject entry carries the pull-request link, the body
  # entry does not. Release Please writes both. The dedupe pass runs after
  # Release Please in the release workflow and keeps one entry per commit,
  # preferring the entry that names the pull request that merged the commit.

  Background:
    Given a generated changelog holding release-note entries

  @unit
  Scenario: Two entries naming one sha keep the one carrying a pull-request link
    Given two entries in one section carry the same commit sha
    And only one of them links a pull request number
    When the dedupe pass runs
    Then the section keeps only the entry carrying the pull-request link

  @unit
  Scenario: Two entries naming one sha and two pull requests keep the merged one
    Given two entries in one section carry the same commit sha
    And each names a different pull request number
    When GitHub answers which pull request the commit merged
    Then the section keeps only the entry naming that pull request

  @unit
  Scenario: Entries without a duplicate are left untouched
    Given every entry in the section names a distinct commit sha
    When the dedupe pass runs
    Then no line changes

  @unit
  Scenario: A whole changelog is rewritten only where it duplicates
    Given a changelog file with duplicated entries across several sections and unduplicated entries beside them
    When the dedupe pass runs over the file
    Then every duplicated sha appears once per section afterwards
    And every other line survives byte for byte
