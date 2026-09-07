Feature: A node-resolution guard for barrels and process entrypoints
  TypeScript resolves a relative or deep-package import specifier by its own
  rules, which are more forgiving than node's. Every backend process runs on
  `node --experimental-transform-types` now, so a specifier that only
  TypeScript can resolve — a barrel missing its `.ts`, a deep import missing
  its `.js`, a barrel naming a file that no longer exists — passes typecheck
  and then breaks the process at boot. This check exercises node's real
  resolver against every feature package's barrel and the three process
  entrypoints, so the defect is caught before it reaches a running process.

  @unit
  Scenario: A barrel whose specifiers carry their on-disk extension resolves
    Given a barrel that re-exports a sibling module by its exact file name
    When the check probes it with node's resolver
    Then it is reported ok

  @unit
  Scenario: An extensionless relative specifier fails resolution and names the file and specifier
    Given a barrel that re-exports a sibling module without its file extension
    When the check probes it with node's resolver
    Then it is reported as a resolution failure
    And the failure names the unresolvable specifier
    And the failure names the file that imported it

  @unit
  Scenario: A missing .tsx extension is expected for a browser package and is not a failure
    Given a barrel under a browser-package path that re-exports a sibling .tsx module
    When the check probes it with node's resolver
    Then it is reported as skipped, not failed
