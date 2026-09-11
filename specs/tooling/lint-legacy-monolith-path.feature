Feature: The legacy-monolith-path lint rule
  `platform/app` was the monolith that `apps/*` and `modules/*` replaced, and
  `~/` was the alias that only ever resolved inside it. No tsconfig maps `~/*`
  now, so a stale path resolves to nothing and TypeScript says so only when
  something reaches the file - which is how a moved test or a half-finished
  port keeps compiling until the first import of it.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: An import through the monolith alias is refused
    Given a source file that imports through the monolith's `~/` alias
    When the legacy-monolith-path rule runs over it
    Then it reports legacyMonolithPath
    And the message names the offending path

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
