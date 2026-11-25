Feature: The legacy-monolith-path lint rule
  `platform/app` was the monolith that `apps/*` and `modules/*` replaced, and
  `~/` and `@app/` were the aliases that only ever resolved inside it. No tsconfig maps `~/*`
  now, so a stale path resolves to nothing and TypeScript says so only when
  something reaches the file - which is how a moved test or a half-finished
  port keeps compiling until the first import of it.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: An import through the monolith alias is refused
    Given a source file that imports through the monolith's `~/` or `@app/` alias
    When the legacy-monolith-path rule runs over it
    Then it reports legacyMonolithPath at the specifier
    And the message names the offending path
    And the fix names where modules live today, not the retired folder names

  @unit
  Scenario: An import naming the deleted platform directory is refused
    Given a source file that imports a path naming `platform/app`
    When the legacy-monolith-path rule runs over it
    Then it reports legacyMonolithPath

  @unit
  Scenario: A string naming a platform path is refused
    Given a source file with a plain string naming a `platform/app` path
    When the legacy-monolith-path rule runs over it
    Then it reports legacyMonolithPath

  @unit
  Scenario: An import from a module package is allowed
    Given a source file that imports from a module package
    When the legacy-monolith-path rule runs over it
    Then it reports nothing

  @unit
  Scenario: An application's own platform directory is allowed
    Given a source file that names an application's own `src/platform` directory
    When the legacy-monolith-path rule runs over it
    Then it reports nothing

  @unit
  Scenario: A path whose segment merely ends in platform is allowed
    Given a source file that names a path whose segment merely ends in "platform"
    When the legacy-monolith-path rule runs over it
    Then it reports nothing

  # `~/` only means the monolith's alias where a module specifier is expected.
  # A bare string starting `~/` is a home directory, and the CLI is full of
  # them: `~/.codex/hooks.json` is not a stale import, and telling its author
  # to re-point a specifier asks for something that does not exist.
  @unit
  Scenario: A home-directory string is not a monolith path
    Given a source file with a plain string beginning "~/" that is not an import
    When the legacy-monolith-path rule runs over it
    Then it reports nothing
    But an import through the same "~/" alias is still reported

  # A test is the one place the old paths must be written down. The CI
  # path-filter suites keep them under `wasFiles` precisely to prove the
  # monolith is gone, so reporting them asks the author to re-point a specifier
  # that is deliberately historical.
  @unit
  Scenario: A test may name a platform path in a plain string
    Given a test file with a plain string naming a `platform/app` path
    When the legacy-monolith-path rule runs over it
    Then it reports nothing
    But the same string in a production file is still reported
    And an import naming `platform/app` is still reported, test file or not

  @unit
  Scenario: A stale import is reported once, not twice
    Given a source file importing through the monolith alias
    When the legacy-monolith-path rule runs over it
    Then it reports exactly one finding for that import
