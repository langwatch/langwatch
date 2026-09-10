# See ../../dev/docs/adr/137-module-source-grammar.md
# A service throws a HandledError subclass and a client reads its `code`, so
# both sides need the class; it cannot live in the server package the client
# may not import.

Feature: The linter keeps HandledError subclasses in the contract

  As a module author
  I want the linter to refuse a HandledError subclass declared in the server
  package
  So that both the service that throws it and the client that reads its code
  can import the same class

  Background:
    Given the langwatch oxlint plugin runs over the workspace sources

  Rule: A HandledError subclass declared under server/src is reported

    @unit
    Scenario: A HandledError subclass declared in the server package is reported
      Given a class extending HandledError declared under a core module's
        server/src
      When the rule runs
      Then it names the class and says to move it to the module's contract
        errors file

    @unit
    Scenario: A HandledError subclass in an enterprise server package is reported
      Given a class extending HandledError declared under an enterprise
        module's server/src
      When the rule runs
      Then it names the enterprise module's contract errors file

  Rule: The contract package, and a plain error, are not this rule's business

    @unit
    Scenario: A subclass of a plain error is not this rule's business
      Given a class extending Error, not HandledError, declared under
        server/src
      When the rule runs
      Then it reports nothing

    @unit
    Scenario: A HandledError subclass declared in its contract package is not this rule's business
      Given a class extending HandledError declared under the module's
        contract package
      When the rule runs
      Then it reports nothing
