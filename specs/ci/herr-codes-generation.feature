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

  # A code is a code wherever it is written. Each of these compiles and puts the
  # same string on the wire, so each has to reach the presentation registry;
  # missing one leaves a live code with no customer copy and the drift check
  # green, which is the failure this whole mechanism exists to prevent.
  Scenario Outline: A code is generated wherever it is written
    Given a code is declared <how>
    When the generator runs
    Then the generated file carries it

    Examples:
      | how                                            |
      | as a var rather than a const                   |
      | inside a map or struct literal                 |
      | inside a function body                         |
      | as a bare string passed to a herr constructor  |

  Scenario: A trailing note beside a declaration is not treated as its description
    Given a code is declared with a trailing line comment
    When the generator runs
    Then the entry carries no description
    And the note is not presented as what the code means

  Scenario: A code the generator cannot read stops the run
    Given a code is assembled from something other than a plain string
    When the generator runs
    Then it fails and names the file and line
    And it says to write the code as a plain string

  Scenario: A source file that does not parse stops the run
    Given a Go service file is mid-refactor and does not parse
    When the generator runs
    Then it fails and names the file
    And no truncated file is written

  Scenario: A documentation snippet that does not parse is skipped with a warning
    Given the onboarding documentation carries hand-written Go that never compiles
    When the generator runs
    Then it warns and carries on
    And every real code still reaches the generated file

  Scenario: Pointing the generator at the wrong root stops the run
    Given the generator is pointed at a directory that declares no codes
    When it runs
    Then it fails rather than writing an empty file

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

  # A failing workflow node reports its own code, separately from the codes a
  # service raises at its HTTP boundary. The studio shows those codes to the
  # person who built the workflow, so the presentation registry is exhaustive
  # over them too — and everything below exists because that channel was an open
  # set pretending to be a closed one.
  Rule: Workflow node failures carry a generated code

    Scenario: A node failure the engine names is generated
      Given the engine reports a failed node with a named failure
      When the generator runs
      Then the generated file carries that failure alongside the service codes

    Scenario: A node failure named somewhere the generator cannot read stops the run
      Given the engine passes a failure through from somewhere else
      And the name it puts on the wire cannot be read from the source
      When the generator runs
      Then it fails and names the file and line
      And it says to normalise the failure onto a name the client knows

    Scenario: A failure raised by the customer's own code is reported as a code the client knows
      Given a customer's code node raises an exception of their own
      When the run reports the failure
      Then the failure carries a code the customer-facing copy is written for
      And the exception the customer's code raised is kept in the message
      And it is never put on the wire as though it were one of our codes

    Scenario: A code node running past its time limit says so
      Given a customer's code node is stopped for running too long
      When the run reports the failure
      Then the failure carries the timeout code rather than a generic one

    Scenario: A failure with no name we recognise still lands on a known code
      Given the code runner reports a failure it does not name
      When the run reports the failure
      Then the failure carries the closest code we do know
      And it never carries a name that would be presented as a different kind of fault
