Feature: The environment-boundaries lint rule
  A reusable package or an application feature never reads `process.env` or
  `import.meta.env` directly — only a `platform/config/` module or a process
  boot file (`*.composition.ts`, `*.executable.ts`, ...) may, so a typed value
  reaches everything downstream instead of a raw environment lookup.

  @unit
  Scenario: Reading process.env outside a composition root is reported
    Given a strict feature service module that reads process.env directly
    When the environment-boundaries rule runs over it
    Then it reports environment
    And the message tells the reader to parse it in platform/config or a composition file

  @unit
  Scenario: A composition root may read process.env
    Given a file named as the application's composition root
    When the environment-boundaries rule runs over it
    Then it reports nothing

  @unit
  Scenario: A test file may read process.env
    Given a strict feature service test module that reads process.env directly
    When the environment-boundaries rule runs over it
    Then it reports nothing
