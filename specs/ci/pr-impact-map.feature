Feature: PR impact map comment
  As a reviewer
  I want a single comment summarising which parts of the monorepo a PR touches
  So that I can judge blast radius before reading the diff

  Background:
    Given the pr-impact-map workflow runs on pull_request events
    And it identifies its own comment by the hidden marker "<!-- pr-impact-map -->"

  Scenario: A comment is posted when a pull request is opened
    When a pull request is opened
    Then a comment carrying the impact-map marker is posted exactly once

  Scenario: The existing comment is updated when new commits are pushed
    Given a pull request already has a comment carrying the impact-map marker
    When a new commit is pushed to the pull request branch
    Then the existing comment is updated in place
    And no additional comment is created

  Scenario: A comment is posted when a closed pull request is reopened
    Given a pull request has been closed
    When the pull request is reopened
    Then the impact-map comment reflects the current head commit

  Scenario: Rapid successive pushes do not create duplicate comments
    Given a pull request receives two pushes in quick succession
    When both workflow runs are triggered
    Then the earlier run is cancelled before it posts
    And the pull request carries exactly one impact-map comment

  Scenario: Pull requests from forks are skipped
    Given a pull request originates from a forked repository
    When the workflow is triggered
    Then no comment is attempted
    And the workflow does not fail

  Scenario: Each changed file is counted in exactly one category
    Given a pull request changes files across several areas of the monorepo
    When the impact map is built
    Then every changed file is attributed to exactly one category
    And the category file counts sum to the pull request's total changed files

  Scenario: The first matching category wins
    Given a changed file could match more than one category rule
    When the impact map is built
    Then the file is attributed to the earliest matching rule

  Scenario: Migration files are attributed to Migrations, not to the application
    Given a pull request changes "platform/app/prisma/migrations/0001_init/migration.sql"
    When the impact map is built
    Then the file is attributed to "Migrations"

  Scenario: Test files are attributed to Tests, not to the code they cover
    Given a pull request changes "platform/app/src/server/analytics/__tests__/analytics.service.test.ts"
    When the impact map is built
    Then the file is attributed to "Tests"

  Scenario: SDK files are attributed to SDKs, not to their language
    Given a pull request changes "sdks/python/src/langwatch/client.py"
    When the impact map is built
    Then the file is attributed to "SDKs"

  Scenario: Lockfiles are attributed to Deps, not to their language
    Given a pull request changes only "platform/app/pnpm-lock.yaml"
    When the impact map is built
    Then the file is attributed to "Deps"
    And the map does not report a change to the application

  Scenario: Categories with no changed files are omitted
    Given a pull request changes only documentation
    When the impact map is built
    Then only the "Docs" row is rendered
    And rows with zero files are absent

  Scenario: A pull request with no changed files renders an empty-state message
    Given a pull request changes no files
    When the impact map is built
    Then the comment states that no files were changed
    And no category table is rendered

  Scenario: Truncation is disclosed when the file list exceeds the API limit
    Given a pull request changes more files than the GitHub API will return
    When the impact map is built
    Then the comment discloses that the file list was truncated
    And the counts are not presented as complete
