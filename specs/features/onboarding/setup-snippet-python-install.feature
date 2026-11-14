Feature: Setup snippets install a Python SDK release with the tracing API
  As a developer copying a Python install line from the onboarding screens
  I want the install to fetch a release that has setup and connect_agent
  So that pip refuses on an unsupported interpreter instead of installing a release without them

  # 1.3.0 is the first release with connect_agent. The quotes keep the shell from reading ">".
  # Bound in python-install-floor.unit.test.ts of the onboarding and trace codegen folders.

  @unit
  Scenario: Every Python framework snippet installs langwatch 1.3.0 or newer
    Given the onboarding integration registry
    When I read the pip and uv install line of each Python framework
    Then each one asks for "langwatch>=1.3.0" in double quotes

  @unit
  Scenario: The tracing setup prompt installs langwatch 1.3.0 or newer
    Given I copy the "Add LangWatch tracing to your code" prompt
    When I read its Python install lines
    Then the pip and uv lines ask for "langwatch>=1.3.0" in double quotes
    And no line asks for a bare langwatch
