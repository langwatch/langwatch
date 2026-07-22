Feature: Python SDK example test input
  As an SDK maintainer
  I want example tests to construct their user input locally
  So provider availability and quota do not fail the test harness before an example runs

  @unit
  Scenario: Example tests use deterministic local input
    Given an example test needs a generic user message
    When the test harness constructs that message
    Then it uses deterministic local content
    And it does not call a model only to generate test input

  @unit
  Scenario: Provider quota failures are classified as external service issues
    Given an example calls a model provider
    When the provider reports exhausted quota
    Then the harness classifies it as an external service issue
