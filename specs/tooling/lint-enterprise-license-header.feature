Feature: The enterprise-license-header lint rule
  An Enterprise SPDX directive marks proprietary source. Outside `enterprise/`
  it marks source that has left the Enterprise module that owns it, so the rule
  reports the directive where it is written and asks for the code to move back,
  never for the marker to be deleted. Tests, fixtures, generated files and
  declaration files are not production source and are not read.

  @unit
  Scenario: Enterprise-licensed source outside enterprise is reported at the directive line
    Given a core module source file that opens with the Enterprise SPDX directive
    When the enterprise-license-header rule runs over it
    Then it reports enterpriseLicenseOutsideEnterprise on line 1

  @unit
  Scenario: A directive inside a block comment is reported at its own line
    Given an application source file whose JSDoc block carries the directive on its second line
    When the enterprise-license-header rule runs over it
    Then it reports line 2, not the line the comment opens on

  @unit
  Scenario: The marker inside a string is not a directive
    Given a source file whose only mention of the marker is a string literal
    When the enterprise-license-header rule runs over it
    Then it reports nothing

  @unit
  Scenario: Enterprise source, tests, fixtures and declarations are not reported
    Given the directive in Enterprise module source, a test, a fixture, a generated file and a declaration file
    When the enterprise-license-header rule runs over each
    Then it reports nothing
