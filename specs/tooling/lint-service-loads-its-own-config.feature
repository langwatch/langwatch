# See ../../dev/docs/adr/141-platform-invariants.md and fc80f65635, where three
# methods each re-validated Auth0 credentials the caller already held instead
# of being handed one validated config.

Feature: The linter keeps a service from resolving its own configuration

  As a module author
  I want the linter to refuse a service that loads its own configuration
  So that config is validated once at the composition root and handed in as
  a named argument

  Background:
    Given the langwatch oxlint plugin runs over the workspace sources

  Rule: A service that resolves its own config is reported

    @unit
    Scenario: A service's own loadConfig function is reported
      Given a service file declaring a top-level loadConfig function
      When the rule runs
      Then it names the function and says to add a named config argument
        instead

    @unit
    Scenario: A service's own resolveConfig arrow function is reported
      Given a service file declaring a resolveConfig arrow function
      When the rule runs
      Then it is reported too

    @unit
    Scenario: A service's own readConfig method is reported
      Given a service class declaring a readConfig method
      When the rule runs
      Then it is reported too

  Rule: A service given its config, a process.env read, or a file outside services is not this rule's business

    @unit
    Scenario: A service reading process.env is environment-boundaries' business
      Given a service file reading process.env directly
      When the rule runs
      Then it reports nothing, because environment-boundaries refuses the read

    @unit
    Scenario: A service given its config as an argument is not this rule's business
      Given a service whose create method takes a config argument instead of
        resolving one itself
      When the rule runs
      Then it reports nothing

    @unit
    Scenario: A file outside services is not this rule's business
      Given a file outside services/ declaring a loadConfig function
      When the rule runs
      Then it reports nothing
