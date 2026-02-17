Feature: Stripe price catalog sync for SaaS billing
  As a LangWatch SaaS maintainer
  I want billing price ids to be sourced from a synced Stripe catalog file
  So that plan key mapping is validated against Stripe without hardcoded ids in runtime code

  @integration
  Scenario: Sync task fetches Stripe prices for the detected key mode
    Given the billing system is configured with valid Stripe credentials
    When I run the stripe prices sync task
    Then the task fetches all prices from Stripe
    And the generated catalog includes the detected mode prices

  @integration
  Scenario: Sync task enforces required key mappings for current mode
    Given the required billing keys are defined
    When the sync task cannot resolve one required key for the detected mode
    Then the task fails with a validation error

  @integration
  Scenario: Sync task preserves the opposite mode mapping
    Given the price catalog includes both test and live price mappings
    When I run the sync task with a test key
    Then the test mapping is updated from Stripe data
    And the live mapping remains unchanged

  @unit
  Scenario: Billing runtime resolves live price ids in production
    Given stripeCatalog.json has mapping values for test and live
    When the system runs in production mode
    Then billing resolves live price ids for required keys

  @unit
  Scenario: Billing runtime resolves test price ids outside production
    Given stripeCatalog.json has mapping values for test and live
    When the system runs outside production mode
    Then billing resolves test price ids for required keys

  @unit
  Scenario: Extra development prices do not break required mapping validation
    Given the catalog includes additional non-required development prices
    When required keys are all mapped for the detected mode
    Then validation succeeds
