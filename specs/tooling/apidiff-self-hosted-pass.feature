# The diff stacks run as SaaS, which hides the instance-admin routes, so apidiff
# defers the scenarios that need the instance-admin key, to run later on a
# stack started with IS_SAAS=false.
# Bound by Go tests in tools/apidiff, annotated `// @scenario`.

Feature: apidiff defers the scenarios a SaaS run cannot reach

  As a developer proving parity for self-hosted and licence-gated features
  I want the scenarios a SaaS run deferred to be listed for a self-hosted run
  So that deferred never quietly means untested

  @unit
  Scenario: The self-hosted pass runs exactly the scenarios the SaaS run deferred
    Given a SaaS run deferred the scenarios that need the instance-admin key
    When the run ends
    Then the run directory holds deferred.txt with one deferred id per line
    And "-scenario-id @deferred.txt" selects exactly those scenarios
    And a list naming no id is refused rather than selecting every scenario
