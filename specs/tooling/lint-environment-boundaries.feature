Feature: The environment-boundaries lint rule
  Config is drilled, never ambient: a module, a package or an application
  file never reads `process.env` or `import.meta.env` directly. Only an
  application's `src/config.ts` reads the environment (its `src/main.ts`
  imports what it needs from there), and
  `@langwatch/secrets` resolves the classified keys; everything downstream
  receives a typed value declared in its module's config schema.

  @unit
  Scenario: Reading process.env outside a composition root is reported
    Given a strict feature service module that reads process.env directly
    When the environment-boundaries rule runs over it
    Then it reports environment
    And the message tells the reader to declare the key in the module's config schema

  @unit
  Scenario: An application's config.ts may read process.env
    Given an application's src/config.ts that reads process.env
    When the environment-boundaries rule runs over it
    Then it reports nothing

  @unit
  Scenario: Any other application file reading process.env is reported
    Given an application source file other than its config.ts, its main.ts included
    When the environment-boundaries rule runs over it
    Then it reports environment

  @unit
  Scenario: The published CLI may read process.env
    Given a source file in apps/server, the npx CLI whose configuration surface is the environment
    When the environment-boundaries rule runs over it
    Then it reports nothing

  @unit
  Scenario: The secrets package may read process.env
    Given a source file in packages/secrets that reads process.env
    When the environment-boundaries rule runs over it
    Then it reports nothing

  @unit
  Scenario: A test file may read process.env
    Given a strict feature service test module that reads process.env directly
    When the environment-boundaries rule runs over it
    Then it reports nothing

  @unit
  Scenario: The test process's boot seam in packages/vitest-config may read process.env
    Given a source file in packages/vitest-config that reads process.env
    When the environment-boundaries rule runs over it
    Then it reports nothing, because it is the test process's boot seam
    And another package, or a file named like it elsewhere, still reports environment
