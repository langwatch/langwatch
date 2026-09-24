Feature: The gateway registers its own spend pipeline
  gateway_spend_processing is the gateway module's pipeline, declared with withEventing
  (ARCHITECTURE §9, WP-6b). The api sends onto it; the worker folds the spend ledger.

  @unit
  Scenario: The spend pipeline is registered in both roles
    Given the gateway module installed with its members
    When its eventing is built for the api and for the worker
    Then both builds name gateway_spend_processing
    And the worker's build folds into the ClickHouse spend ledger
