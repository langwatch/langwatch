Feature: Machine identifiers read as code
  As someone reading a table or a sentence
  I want event names, permission ids and env vars set apart as code
  So that I can tell an identifier from prose at a glance

  @integration
  Scenario: An identifier renders as a code element with its full text as title
    Given the identifier "gateway.virtual_key.created"
    Then it renders in a code element whose title is the full identifier

  @integration
  Scenario: A glob wildcard is emphasised
    Given the identifier "gateway.*"
    Then the asterisk is set apart from the rest of the text
