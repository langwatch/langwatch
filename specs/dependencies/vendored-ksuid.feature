# The KSUID libraries (github.com/langwatch/ksuid) were vendored into this
# repository: packages/ksuid (npm, @langwatch/ksuid) and packages/ksuid-python
# (PyPI, langwatch-ksuid). Both release through the monorepo's release-please
# (.github/release-please-config.json) and publish through ksuid-javascript-cd
# and ksuid-python-cd. Workspace consumers resolve @langwatch/ksuid with the
# workspace protocol, so the npm registry no longer sits between the app and
# its identifier format.

Feature: Vendored KSUID packages
  As a platform maintainer
  I want the KSUID libraries developed and released from this repository
  So that the identifier format evolves with the product that depends on it

  @unit
  Scenario: Generated identifiers stay prefixed and parse back
    When a caller generates an identifier for a resource
    Then the identifier carries the resource prefix
    And parsing it recovers the resource and timestamp

  @unit
  Scenario: The TypeScript package declares no global types
    # The npm package once shipped `declare global` blocks for require and
    # Buffer in its published declarations, and every consumer's global scope
    # inherited them; the monorepo carried a pnpm patch just to strip that.
    # Platform globals now live in an ambient file that is never emitted.
    When the package's modules are inspected
    Then no module contains a global type declaration

  @unit
  Scenario: Both KSUID packages are registered for release
    # An unregistered path ships no release PR, no tag and no publish, and
    # nothing else would notice: the packages sit in exclude-paths of the root
    # component precisely so its releases skip them.
    When the release configuration is read
    Then the TypeScript and Python packages each name a release component
    And the root component excludes both paths

  @unit
  Scenario: The Python wheel packages the ksuid module
    # The standalone repository's wheel target named a directory that did not
    # exist ("langwatch-ksuid" instead of "ksuid"), so the built wheel shipped
    # no code at all — and PyPI never received a release to prove it.
    When the Python build configuration is read
    Then the wheel target names the directory the module actually lives in

  @unit
  Scenario: Generated identifiers sort by creation time across 65,536-second boundaries
    # Up to 2.0.2 the writer used `>> 40` and `>> 32`, which JavaScript takes
    # mod 32, so bytes 2-3 held the timestamp's low 16 bits and wrapped to zero
    # every 65,536 seconds (issue #9575).
    Given two identifiers generated one second apart across a 65,536-second boundary
    When they are compared as strings
    Then the older identifier sorts first

  @unit
  Scenario: The TypeScript and Python packages encode the same identifier
    Given the same environment, resource, timestamp, instance and sequence number
    When the TypeScript package encodes them
    Then it produces the string langwatch-ksuid produces
    And parsing it recovers every component, including a sequence number with the top bit set

  @unit
  Scenario: Identifiers in the legacy layout keep their string and their time
    # Identifiers derived from stored inputs (span, trace summary, evaluation,
    # grant, identifier and audit ids) are re-derived later, so they stay on
    # the legacy layout until each row records its own layout.
    Given an identifier written in the legacy layout
    When it is parsed and written again
    Then the string is unchanged
    And the parsed timestamp is the one it was written with
