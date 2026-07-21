Feature: Go error codes are generated into TypeScript
  As a developer
  I want the Go services' handled-error codes mirrored into a generated TypeScript file
  So that the TypeScript control plane cannot compile while a Go code has no customer-facing presentation

  # The generator (cmd/herrgen, rules in tools/herrgen) parses the Go tree with
  # go/ast — never regex — because a code declaration is Go syntax: it can sit in
  # a const block or stand alone, and its doc comment can wrap any number of
  # lines.
  #
  # The doc text carried into TypeScript is the ENGINEER-facing Go doc comment.
  # It is never customer copy; it exists to tell whoever writes the presentation
  # entry what the code means.
  Background:
    Given the Go services declare error codes as `herr.Code("...")` consts
    And HTTP statuses are registered separately with `herr.RegisterStatus`
    And the generated file is packages/handled-error/src/codes.generated.ts

  Scenario: A code declared inside a const block is generated
    Given a const block declares a code with a doc comment
    When the generator runs
    Then the generated file carries the code, its doc comment and its source path

  Scenario: A standalone const is generated
    Given a code is declared as a single const outside any block
    When the generator runs
    Then the generated file carries it exactly as it carries a block member

  Scenario: A code with no registered status omits the status
    Given a code is declared but never passed to `herr.RegisterStatus`
    When the generator runs
    Then its entry carries no HTTP status
    And no status is invented for it

  Scenario: The registered status is resolved through the net/http constant
    Given a code is registered with `http.StatusConflict`
    When the generator runs
    Then its entry carries the numeric status 409

  Scenario: A code declared in more than one service is generated once
    Given two services declare the same code string
    And both register the same HTTP status for it
    When the generator runs
    Then the generated file carries one entry naming every source that declares it

  Scenario: The same code registered with two different statuses fails the run
    Given two services declare the same code string
    And they register different HTTP statuses for it
    When the generator runs
    Then it fails and names both registrations
    And no file is written

  Scenario: Entries are ordered so the diff stays stable
    When the generator runs twice with no Go change in between
    Then the generated file is byte-identical

  Scenario: CI fails when the generated file is stale
    Given a PR adds a Go error code without regenerating
    When the drift check runs
    Then it fails and shows the lines that differ
    And it names the command that regenerates the file
