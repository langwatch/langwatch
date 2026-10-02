Feature: Architecture repair instructions appear at the failing boundary
  Scenario: Enterprise implementation cannot silently move into core
    Given a production module outside enterprise has an Enterprise SPDX directive
    When architecture lint runs
    Then enterprise-license-header reports the module and directive line
    And its repair message requires restoring ownership rather than deleting the marker

  Scenario: An import before the license header cannot conceal ownership
    Given a core module imports a dependency before its Enterprise SPDX directive
    When architecture lint runs
    Then the misplaced implementation is reported

  Scenario: Public boundaries state their own named inputs and outputs
    Given a feature contract, App or application composition mirrors a signature with a global utility type
    When architecture lint runs
    Then signature-mirror directs the author to explicit contract input and output types

  Scenario: Casting through unknown cannot conceal a broken boundary
    Given a composition casts a collaborator through unknown or any to another type
    When architecture lint runs
    Then stand-in-cast requests schema validation or a corrected typed collaborator

  Scenario: Real technical internals remain outside the signature boundary rule
    Given a private repository implementation uses a type utility internally
    When architecture lint runs
    Then the signature boundary rule does not report that technical implementation

  @unit
  Scenario: pnpm's catalog protocol resolves against the workspace catalogue before the retired-runtime check reads it
    Given a feature package that declares a dependency through pnpm's catalog protocol
    When the retired-runtime check reads its range
    Then the range is resolved from the workspace catalogue first

  @unit
  Scenario: A ratchet whose inventory reached zero becomes a plain refusal
    Given a service over its ceiling with no per-file inventory left to raise it
    When the service-ceiling check runs
    Then the service is refused
