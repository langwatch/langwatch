# The diff stacks run as SaaS, which hides the instance-admin routes, so apidiff
# defers the scenarios that need the instance-admin key. The self-hosted pass
# runs exactly those on a stack of its own started with IS_SAAS=false.
# Bound by Go tests in tools/apidiff and tools/diffsuite, annotated `// @scenario`.

Feature: The self-hosted pass of the diff suite

  As a developer proving parity for self-hosted and licence-gated features
  I want the scenarios a SaaS run deferred to run on a self-hosted stack
  So that deferred never quietly means untested

  @unit
  Scenario: The self-hosted pass runs exactly the scenarios the SaaS run deferred
    Given a SaaS run deferred the scenarios that need the instance-admin key
    When the run ends
    Then the run directory holds deferred.txt with one deferred id per line
    And "-scenario-id @deferred.txt" selects exactly those scenarios
    And a list naming no id is refused rather than selecting every scenario

  @unit
  Scenario: diffsuite runs the self-hosted pass on a stack of its own
    Given "diffsuite -deployment self-hosted -up -deferred <file>"
    When the suite starts its stack
    Then the stack is "diffsuite-<time>-selfhosted", started with IS_SAAS=false for that slug only
    And the root .env is not edited
    And the api tool runs only the scenarios the file lists
    And a stack whose instance-admin routes answer 404 is refused as SaaS
