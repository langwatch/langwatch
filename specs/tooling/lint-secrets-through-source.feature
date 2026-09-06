# The lint half of packages/secrets/specs/secret-sources.feature: that spec owns
# how a secret resolves, this one owns the rule that keeps every other module
# from going round the chain.
# See ../../dev/docs/adr/131-secrets-are-not-config.md

Feature: The linter keeps secrets on the source chain
  As a platform maintainer
  I want the linter to refuse a classified secret read straight from the environment
  So that every credential the product uses has been through classification,
  the source chain and log redaction

  Background:
    Given the langwatch oxlint plugin runs over the workspace sources

  Rule: A classified secret is named where it is read

    @unit
    Scenario: Reading a classified secret from the environment is reported
      Given production source that reads a registry secret key off process.env
      When the rule runs
      Then it names the key and says to resolve it through the source chain

    @unit
    Scenario: A bracketed secret read is reported
      Given production source that reads the same key through a bracketed literal
      When the rule runs
      Then it is reported too

    @unit
    Scenario: A configuration read is not this rule's business
      Given production source that reads an unclassified configuration variable
      When the rule runs
      Then it reports nothing

  Rule: The places that resolve a secret may read one

    @unit
    Scenario: The boot seam may read a classified secret
      Given an application config module or process boot file
      When the rule runs
      Then it reports nothing

    @unit
    Scenario: The secrets package may read a classified secret
      Given a source file inside the secrets package
      When the rule runs
      Then it reports nothing

    @unit
    Scenario: A test file may read a classified secret
      Given a test that reads a registry secret key off process.env
      When the rule runs
      Then it reports nothing
