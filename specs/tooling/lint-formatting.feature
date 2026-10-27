# ADR-143: oxfmt is the only formatter and it reads one configuration file.
# The flag that makes that true is easy to drop from an invocation, and the
# failure is silent: the file is still formatted, just differently.

Feature: The formatter reads one configuration
  As a platform maintainer
  I want a file's formatting to be a property of the file, not of the directory the command ran in
  So that no diff appears on lines nobody edited

  Rule: Nested configuration discovery stays off

    @unit
    Scenario: Both format scripts disable nested configuration
      Given the workspace root package manifest
      When the format and format:check scripts are read
      Then both pass --disable-nested-config to oxfmt

  Rule: The declared style is the one ADR-143 records

    @unit
    Scenario: The formatter configuration matches the recorded style
      Given the root .oxfmtrc.json
      When its settings are read
      Then the print width, indent, semicolons, quotes and trailing commas are the recorded values
